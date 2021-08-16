"use strict";

import 'dotenv/config';

import axios from "axios";
import { google } from 'googleapis';
import * as AdmZip from "adm-zip";
import * as fs from 'fs';
import * as Testem from 'testem';

const REPO = 'foundations-checkpoint-pt-1'
const SHEET = 'ch1';
const START_ROW = 5;

(async () => {
  const auth = await google.auth.getClient({ scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const sheets = google.sheets('v4');

  const { data: { values } } = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: `'${SHEET}'!D${START_ROW}:D`,
    auth
  });
  const ids = values.map(v => v[0]).filter(v => v);

  const learndot = axios.create({
    baseURL: "https://learn.fullstackacademy.com",
  });
  const {
    data: { token },
  } = await learndot.post("/auth/local", {
    email: process.env.LEARNDOT_EMAIL,
    password: process.env.LEARNDOT_PASSWORD,
  });
  learndot.defaults.headers.common.Cookie = `token=${token};`;

  const { data: students } = await learndot.get('/api/users/fetch', { params: { ids: ids.slice(0, 5) } });

  const grades = {};

  for (const s of students) {
    try {
      const file = `./${s.github.login}.zip`;
      const stream = fs.createWriteStream(file);
      const { data } = await axios.get(`https://github.com/${s.github.login}/${REPO}/archive/refs/heads/master.zip`, { headers: {
        Authorization: `token ${process.env.GITHUB_ACCESS_TOKEN}`,
      }, responseType: 'stream' });
      await new Promise((resolve, reject) => {
        data.pipe(stream);
        stream.on('error', err => reject(err));
        stream.on('close', () => resolve(true));
      });
      const zip = new AdmZip(file);
      await zip.extractAllTo(`./${s.github.login}`);
      const testem = new Testem();
      await new Promise((res, rej) => testem.startCI({
        file: `./${s.github.login}/${REPO}-master/testem.json`,
        cwd: `./${s.github.login}/${REPO}-master`,
        launch: 'PhantomJS'
      }, exitCode => {
        const { passed, total } = testem.app.reporter;
        grades[s._id] = `${passed} / ${total} tests (${Math.round(passed / total * 100)}%):\n`;
        for (const { result } of testem.app.reporter.reporters[0].results) {
          grades[s._id] += `${result.passed ? '✅' : '❌'}`;
        };
        res(exitCode);
      }));
      fs.rmdirSync(`./${s.github.login}`, { recursive: true });
      fs.unlinkSync(file);
    } catch (err) {
      grades[s._id] = `No submission at https://github.com/${s.github.login}/${REPO} !`;
      console.log(err.message);
    }
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: `'${SHEET}'!N${START_ROW}:N`,
    valueInputOption: 'RAW',
    requestBody: {
      values: values.map(([ id ]) => [ grades[id] ])
    },
    auth
  })

})();

