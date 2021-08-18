"use strict";

import 'dotenv/config';

import axios from "axios";
import { google } from 'googleapis';
import * as AdmZip from "adm-zip";
import * as fs from 'fs';
import * as Testem from 'testem';

const checkpoints = [
  {
    repo: 'foundations-checkpoint-pt-1',
    sheet: 'ch1',
    startRow: 5,
    idCol: 'D',
    column: 'N'
  },
  {
    repo: 'foundations-checkpoint-1-R',
    sheet: 'ch1-replay',
    startRow: 4,
    idCol: 'D',
    column: 'M'
  },
  {
    repo: 'foundations-checkpoint-pt-2',
    sheet: 'ch2',
    startRow: 5,
    idCol: 'D',
    column: 'N'
  },
  {
    repo: 'foundations-checkpoint-2-R',
    sheet: 'ch2-replay',
    startRow: 4,
    idCol: 'D',
    column: 'M'
  },
  {
    repo: 'foundations-final-checkpoint',
    sheet: 'final',
    startRow: 5,
    idCol: 'E',
    column: 'P'
  },
  {
    repo: 'foundations-checkpoint-final-r',
    sheet: 'final-replay',
    startRow: 5,
    idCol: 'D',
    column: 'L'
  }
];

(async () => {
  const auth = await google.auth.getClient({ scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const sheets = google.sheets('v4');

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

  for (const { repo, sheet, startRow, idCol, column } of checkpoints) {
    const { data: { values } } = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: `'${sheet}'!${idCol}${startRow}:${idCol}`,
      auth
    });
    const ids = values.map(v => v[0]).filter(v => v);

    const { data: students } = await learndot.get('/api/users/fetch', { params: { ids } });

    const grades = {};

    for (const s of students) {
      try {
        const file = `./${s.github.login}.zip`;
        const stream = fs.createWriteStream(file);
        const { data } = await axios.get(`https://github.com/${s.github.login}/${repo}/archive/refs/heads/master.zip`, { headers: {
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
          file: `./${s.github.login}/${repo}-master/testem.json`,
          cwd: `./${s.github.login}/${repo}-master`,
          launch: 'PhantomJS'
        }, exitCode => {
          const { passed, total } = testem.app.reporter;
          grades[s._id] = '';
          for (const { result } of testem.app.reporter.reporters[0].results) grades[s._id] += result.passed ? '✅' : '❌';
          grades[s._id] += `: ${passed} / ${total} tests (${Math.round(passed / total * 100)}%)`;
          res(exitCode);
        }));
        fs.rmdirSync(`./${s.github.login}`, { recursive: true });
        fs.unlinkSync(file);
      } catch (err) {
        try {
          fs.unlinkSync(`./${s.github.login}.zip`);
        } catch (e) {}
        grades[s._id] = s.github ? `No submission at https://github.com/${s.github.login}/${repo} on ${Date.now()}!` : `No GitHub acount linked as of ${Date.now()}`;
        console.log(err.message);
      }
    }

    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: `'${sheet}'!${column}${startRow}:${column}`,
      valueInputOption: 'RAW',
      requestBody: {
        values: values.map(([ id ]) => [ grades[id] ])
      },
      auth
    });
  }
})();

