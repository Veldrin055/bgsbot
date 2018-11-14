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

import * as express from 'express';
import * as logger from 'morgan';

import IndexRouter from './routes/index';
import { DiscordClient } from './modules/discord/client';
import { DB } from './db';
import { AutoReport } from './modules/cron/index';
import { TickDetector } from './modules/listener/index';

class App {
    public express: express.Application;
    public db: DB;
    public discordClient: DiscordClient;

    constructor() {
        this.express = express();
        this.middleware();
        this.routes();
        this.discordClient = new DiscordClient();
        this.db = new DB();
        this.cron();
        this.listener();
    }

    private middleware(): void {
        this.express.use(logger('dev'));
    }

    private routes(): void {
        this.express.use('/', IndexRouter);
    }

    private cron(): void {
        this.db.model.guild.find()
            .then(guilds => {
                AutoReport.initiateJob(guilds, this.discordClient.client)
            })
            .catch(err => {
                console.log(err);
            });
    }

    private listener(): void {
        this.db.model.guild.find()
            .then(guilds => {
                TickDetector.initiateSocket(guilds, this.discordClient.client)
            })
            .catch(err => {
                console.log(err);
            });
    }
}

let app = new App();

export default app;
