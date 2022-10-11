"use strict";
import 'dotenv/config';
import axios from "axios";
import { google } from 'googleapis';
import * as AdmZip from "adm-zip";
import * as fs from 'fs';
import * as Testem from 'testem';
import checkpoints from './checkpoints';

(async () => {
  const courseIds = process.env.CANVAS_COURSE_IDS.split(',');
  const auth = await google.auth.getClient({ scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const sheets = google.sheets('v4');
  const learndot = axios.create({ baseURL: 'https://learn.fullstackacademy.com' });
  const { data: { token } } = await learndot.post("/auth/local", {
    email: process.env.LEARNDOT_EMAIL,
    password: process.env.LEARNDOT_PASSWORD,
  });
  learndot.defaults.headers.common.Cookie = `token=${token};`;
  const canvas = axios.create({ baseURL: 'https://fullstack.instructure.com/api/v1' });
  canvas.defaults.headers.common.Authorization = `Bearer ${process.env.CANVAS_ACCESS_TOKEN}`;
  const quizzes = {};
  for (const cid of courseIds)
    quizzes[cid] = (await canvas.get(`/courses/${cid}/quizzes`)).data;

  for (const { repo, sheet, startRow, idCol, column, canvasName } of checkpoints) {
    const quizIds = {};
    for (const cid of courseIds)
      quizIds[cid] = quizzes[cid].find(quiz => quiz.title === canvasName).id;
    const submissions = {};
    for (const cid of courseIds)
      submissions[cid] = (await canvas.get(`/courses/${cid}/quizzes/${quizIds[cid]}/submissions?per_page=9999`)).data.quiz_submissions;
    const { data: { values } } = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: `'${sheet}'!${idCol}${startRow}:${idCol}`,
      auth,
    });
    const ids = (values ?? []).map(v => v[0]).filter(v => v);
    const { data: students } = await learndot.get('/api/users/fetch', { params: { ids } });
    const canvasStudents = {};
    for (const cid of courseIds)
      canvasStudents[cid] = (await canvas.get(`/courses/${cid}/users?per_page=9999`)).data;
    const grades = {};
    for (const s of students) {
      console.log(s.fullName, s._id, repo);
      let github: string, canvasId, submissionId, courseId, submissionEvents = [] as any;
      try {
        courseId = Object.keys(canvasStudents).find(cid => canvasStudents[cid].find(cs => cs.login_id === s.email));
        canvasId = canvasStudents[courseId].find(cs => cs.login_id === s.email).id;
        submissionId = submissions[courseId].find(sub => sub.user_id === canvasId).id;
        submissionEvents = (await canvas.get(`/courses/${courseId}/quizzes/${quizIds[courseId]}/submissions/${submissionId}/events?per_page=99999`)).data.quiz_submission_events;
        github = submissionEvents.flatMap(evt => evt?.event_data).reverse().find(ed => ed?.answer?.includes('github.com')).answer.split(/github.com./)[1].split('/')[0];
      } catch (e) {
        grades[s._id] = [`https://fullstack.instructure.com/courses/${courseId}/quizzes/${quizIds[courseId]}/history?user_id=${canvasId}`, `No Github account in submission at ${new Date().toISOString()}`];
        continue;
      }
      await new Promise(r => setTimeout(r, 2000));
      try {
        const file = `./${github}.zip`;
        const stream = fs.createWriteStream(file);
        const { data } = await axios.get(`https://github.com/${github}/${repo}/archive/refs/heads/master.zip`, { headers: {
          Authorization: `token ${process.env.GITHUB_ACCESS_TOKEN}`,
        }, responseType: 'stream' });
        await new Promise((resolve, reject) => {
          data.pipe(stream);
          stream.on('error', err => reject(err));
          stream.on('close', () => resolve(true));
        });
        const zip = new (AdmZip as (f: any) => void)(file);
        await zip.extractAllTo(`./${github}`);
        const testem = new Testem();
        await new Promise((res, rej) => testem.startCI({
          file: `./${github}/${repo}-master/testem.json`,
          cwd: `./${github}/${repo}-master`,
          launch: 'Headless Chrome',
          port: 8081
        }, exitCode => {
          const { passed, total } = testem.app.reporter;
          grades[s._id] = [`https://github.com/${github}/${repo}`, ''];
          const names = {};
          for (const { result } of testem.app.reporter.reporters[0].results) {
            const resName = result.name.split(' ')[0];
            names[resName] = (names[resName] || '') + (result.passed ? '✅' : '❌');
          }
          for (let resName in names) grades[s._id][1] += `${resName} ${names[resName]} `;
          grades[s._id][1] += `${passed} / ${total} tests (${Math.round(passed / total * 100)}%)`;
          res(exitCode);
        }));
        fs.rmdirSync(`./${github}`, { recursive: true });
        fs.unlinkSync(file);
      } catch (err) {
        try { fs.unlinkSync(`./${github}.zip`); } catch (e) {}
        grades[s._id][1] = `No submission on ${new Date().toISOString()}!`;
        console.log(err.message);
      }
    }

    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: `'${sheet}'!${column}${startRow}:${column}`,
      valueInputOption: 'RAW',
      requestBody: {
        values: (values || []).map(([ id ]) => [ grades[id] ? grades[id][0] : '' ])
      },
      auth
    });
    const nextCol = String.fromCharCode(column.charCodeAt(0) + 1);
    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: `'${sheet}'!${nextCol}${startRow}:${nextCol}`,
      valueInputOption: 'RAW',
      requestBody: {
        values: (values || []).map(([ id ]) => [ grades[id] ? grades[id][1] : '' ])
      },
      auth
    });
  }
})();
