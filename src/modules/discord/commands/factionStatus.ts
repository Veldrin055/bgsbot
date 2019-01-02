/*
 * KodeBlox Copyright 2017 Sayak Mukhopadhyay
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http: //www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as discord from 'discord.js';
import * as request from 'request-promise-native';
import * as moment from 'moment';
import App from '../../../server';
import { Responses } from '../responseDict';
import { DB } from '../../../db/index';
import { Access } from './../access';
import { EBGSFactionsV4WOHistory, FieldRecordSchema, EBGSSystemsV4WOHistory } from "../../../interfaces/typings";
import { OptionsWithUrl, FullResponse } from 'request-promise-native';

export class FactionStatus {
    db: DB;
    constructor() {
        this.db = App.db;
    }
    exec(message: discord.Message, commandArguments: string): void {
        let argsArray: string[] = [];
        if (commandArguments.length !== 0) {
            argsArray = commandArguments.split(" ");
        }
        if (argsArray.length > 0) {
            let command = argsArray[0].toLowerCase();
            if (this[command]) {
                this[command](message, argsArray);
            } else {
                message.channel.send(Responses.getResponse(Responses.NOTACOMMAND));
            }
        } else {
            message.channel.send(Responses.getResponse(Responses.NOPARAMS));
        }
    }

    async get(message: discord.Message, argsArray: string[]) {
        try {
            await Access.has(message.member, [Access.ADMIN, Access.BGS, Access.FORBIDDEN]);
            if (argsArray.length >= 2) {
                let factionName: string = argsArray.slice(1).join(" ").toLowerCase();

                let requestOptions: OptionsWithUrl = {
                    url: "http://elitebgs.kodeblox.com/api/ebgs/v4/factions",
                    qs: { name: factionName },
                    json: true,
                    resolveWithFullResponse: true
                }

                let response: FullResponse = await request.get(requestOptions);
                if (response.statusCode == 200) {
                    let body: EBGSFactionsV4WOHistory = response.body;
                    if (body.total === 0) {
                        try {
                            await message.channel.send(Responses.getResponse(Responses.FAIL));
                            message.channel.send("Faction not found");
                        } catch (err) {
                            console.log(err);
                        }
                    } else {
                        let responseFaction = body.docs[0];
                        let factionName = responseFaction.name;
                        let government = responseFaction.government;
                        let presence = responseFaction.faction_presence;
                        let systemPromises: Promise<[string, string, string, number]>[] = [];
                        presence.forEach(system => {
                            let requestOptions: OptionsWithUrl = {
                                url: "http://elitebgs.kodeblox.com/api/ebgs/v4/systems",
                                qs: { name: system.system_name_lower },
                                json: true,
                                resolveWithFullResponse: true
                            }
                            systemPromises.push((async () => {
                                let response: FullResponse = await request.get(requestOptions);
                                if (response.statusCode == 200) {
                                    let body: EBGSSystemsV4WOHistory = response.body;
                                    if (body.total === 0) {
                                        try {
                                            await message.channel.send(Responses.getResponse(Responses.FAIL));
                                            return [system.system_name, "System status not found", system.system_name, 0] as [string, string, string, number];
                                        } catch (err) {
                                            console.log(err);
                                        }
                                    } else {
                                        let responseSystem = body.docs[0];
                                        let systemName = system.system_name;
                                        let state = system.state;
                                        let influence = system.influence;
                                        let pendingStatesArray = system.pending_states;
                                        let recoveringStatesArray = system.recovering_states;
                                        let updatedAt = moment(responseSystem.updated_at);
                                        let factionDetail = "";
                                        factionDetail += `Last Updated : ${updatedAt.fromNow()} \n`;
                                        factionDetail += `State : ${state}\n`;
                                        factionDetail += `Influence : ${(influence * 100).toFixed(1)}%\n`;
                                        let pendingStates: string = "";
                                        if (pendingStatesArray.length === 0) {
                                            pendingStates = "None";
                                        } else {
                                            pendingStatesArray.forEach((pendingState, index, factionPendingStates) => {
                                                let trend = this.getTrendIcon(pendingState.trend);
                                                pendingStates = `${pendingStates}${pendingState.state}${trend}`;
                                                if (index !== factionPendingStates.length - 1) {
                                                    pendingStates = `${pendingStates}, `
                                                }
                                            });
                                        }
                                        factionDetail += `Pending States : ${pendingStates}\n`;
                                        let recoveringStates: string = "";
                                        if (recoveringStatesArray.length === 0) {
                                            recoveringStates = "None";
                                        } else {
                                            recoveringStatesArray.forEach((recoveringState, index, factionRecoveringState) => {
                                                let trend = this.getTrendIcon(recoveringState.trend);
                                                recoveringStates = `${recoveringStates}${recoveringState.state}${trend}`;
                                                if (index !== factionRecoveringState.length - 1) {
                                                    recoveringStates = `${recoveringStates}, `
                                                }
                                            })
                                        }
                                        factionDetail += `Recovering States : ${recoveringStates}`;
                                        return [systemName, factionDetail, systemName, influence] as [string, string, string, number];
                                    }
                                } else {
                                    throw new Error(response.statusMessage);
                                }
                            })());
                        });
                        try {
                            let systems = await Promise.all(systemPromises);
                            let fieldRecord: FieldRecordSchema[] = [];
                            systems.forEach(system => {
                                fieldRecord.push({
                                    fieldTitle: system[0],
                                    fieldDescription: system[1],
                                    influence: system[3],
                                    name: system[2]
                                });
                            });
                            try {
                                let guild = await this.db.model.guild.findOne({ guild_id: message.guild.id });
                                if (guild) {
                                    if (guild.sort && guild.sort_order && guild.sort_order !== 0) {
                                        fieldRecord.sort((a, b) => {
                                            if (guild.sort === 'name') {
                                                if (guild.sort_order === -1) {
                                                    if (a.name.toLowerCase() < b.name.toLowerCase()) {
                                                        return 1;
                                                    } else if (a.name.toLowerCase() > b.name.toLowerCase()) {
                                                        return -1;
                                                    } else {
                                                        return 0;
                                                    }
                                                } else if (guild.sort_order === 1) {
                                                    if (a.name.toLowerCase() < b.name.toLowerCase()) {
                                                        return -1;
                                                    } else if (a.name.toLowerCase() > b.name.toLowerCase()) {
                                                        return 1;
                                                    } else {
                                                        return 0;
                                                    }
                                                } else {
                                                    return 0;
                                                }
                                            } else if (guild.sort === 'influence') {
                                                if (guild.sort_order === -1) {
                                                    return b.influence - a.influence;
                                                } else if (guild.sort_order === 1) {
                                                    return a.influence - b.influence;
                                                } else {
                                                    return 0;
                                                }
                                            } else {
                                                return 0;
                                            }
                                        });
                                    }
                                    let numberOfMessages = Math.ceil(fieldRecord.length / 24);
                                    for (let index = 0; index < numberOfMessages; index++) {
                                        let embed = new discord.RichEmbed();
                                        if (index === 0) {
                                            embed.setTitle("FACTION STATUS");
                                        } else {
                                            embed.setTitle(`FACTION STATUS - continued - Pg ${index + 1}`);
                                        }
                                        embed.setColor([255, 0, 255]);
                                        embed.addField(factionName, government, false);
                                        embed.setTimestamp(new Date());
                                        let limit = 0;
                                        if (fieldRecord.length > index * 24 + 24) {
                                            limit = index * 24 + 24;
                                        } else {
                                            limit = fieldRecord.length;
                                        }
                                        for (let recordIndex = index * 24; recordIndex < limit; recordIndex++) {
                                            embed.addField(fieldRecord[recordIndex].fieldTitle, fieldRecord[recordIndex].fieldDescription);
                                        }
                                        try {
                                            await message.channel.send(embed);
                                        } catch (err) {
                                            console.log(err);
                                        }
                                    }
                                }
                            } catch (err) {
                                message.channel.send(Responses.getResponse(Responses.FAIL));
                                console.log(err);
                            }
                        } catch (err) {
                            message.channel.send(Responses.getResponse(Responses.FAIL));
                            console.log(err);
                        }
                    }
                } else {
                    console.log(response.statusMessage);
                }
            }
        } catch (err) {
            message.channel.send(Responses.getResponse(Responses.INSUFFICIENTPERMS));
        }
    }

    private getTrendIcon(trend: number): string {
        if (trend > 0) {
            return "⬆️";
        } else if (trend < 0) {
            return "⬇️";
        } else {
            return "↔️";
        }
    }

    help() {
        return [
            'factionStatus',
            'Gets the details of a faction',
            'factionStatus get <faction name>',
            [
                '`@BGSBot factionStatus get knights of karma`'
            ]
        ];
    }
}
