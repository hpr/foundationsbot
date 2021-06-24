"use strict";

require("dotenv").config();
import io from "socket.io-client";
import axios from "axios";

(async () => {
  const memory: string[] = [];

  const learndot = axios.create({
    baseURL: "https://learn.fullstackacademy.com",
  });

  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth();
  const cohorts: string[] = [];
  for (let i = 0; i < 3; i++) {
    if (++month > 12) {
      month = 1;
      year++;
    }
    cohorts.push(`${year}`.slice(-2) + `${month}`.padStart(2, "0"));
  }

  const {
    data: { token },
  } = await learndot.post("/auth/local", {
    email: process.env.LEARNDOT_EMAIL,
    password: process.env.LEARNDOT_PASSWORD,
  });
  learndot.defaults.headers.common.Cookie = `token=${token};`;

  const socket = io("wss://learn.fullstackacademy.com", {
    query: {
      token,
      version: "1.2.0",
    },
    transports: ["websocket"],
    path: "/socket.io-client",
  });

  socket.on("connect_error", (error: object) => {
    console.log(error);
  });

  socket.on("connect", () => {
    console.log("Listening...");

    socket.emit("join", "helpTickets");

    socket.on("helpTickets:save", async (data: any) => {
      const {
        data: { name: cohort },
      } = await learndot.get(`/api/cohorts/${data.cohort}`);
      if (!cohorts.some(c => cohort.includes(c))) return;
      if (memory.includes(data._id)) return;
      memory.push(data._id)
      if (process.env.SLACK_HOOK)
        await axios.post(process.env.SLACK_HOOK, {
          text: `<!here|here> New ticket by ${
            data.requestor.fullName
          } from ${cohort}:\n\`\`\`${data.description.replace(
            /```/g,
            "\\`\\`\\`"
          )}\`\`\``,
        });
    });
  });
})();

