"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv").config();
const socket_io_client_1 = __importDefault(require("socket.io-client"));
const axios_1 = __importDefault(require("axios"));
(async () => {
    const learndot = axios_1.default.create({
        baseURL: 'https://learn.fullstackacademy.com'
    });
    const now = new Date();
    let year = now.getFullYear();
    let month = now.getMonth();
    const cohorts = [];
    for (let i = 0; i < 3; i++) {
        if (++month > 12) {
            month = 1;
            year++;
        }
        cohorts.push(`${year}`.slice(-2) + `${month}`.padStart(2, '0'));
    }
    const { data: { token } } = await learndot.post("/auth/local", {
        email: process.env.LEARNDOT_EMAIL,
        password: process.env.LEARNDOT_PASSWORD,
    });
    learndot.defaults.headers.common.Cookie = `token=${token};`;
    const socket = socket_io_client_1.default("wss://learn.fullstackacademy.com", {
        query: {
            token,
            version: "1.2.0",
        },
        transports: ["websocket"],
        path: "/socket.io-client",
    });
    socket.on("connect_error", (error) => {
        console.log(error);
    });
    socket.on("connect", () => {
        console.log("Listening...");
        socket.emit("join", "helpTickets");
        socket.on("helpTickets:save", async (data) => {
            const { data: { name: cohort } } = await learndot.get(`/api/cohorts/${data.cohort}`);
            console.log(cohorts);
            // if (!cohorts.some(c => cohort.includes(c))) return;
            await axios_1.default.post(`${process.env.SLACK_HOOK}`, {
                text: `<!here|here> New ticket by ${data.requestor.fullName} from ${cohort}:\n\`\`\`${data.description.replace(/```/g, '\\`\\`\\`')}\`\`\``
            });
        });
    });
})();
