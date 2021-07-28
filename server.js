const { Telegraf, Markup } = require("telegraf");
const { createRoom } = require("./db");
require("dotenv").config();

const bot = new Telegraf(process.env.TOKEN);

bot.start((ctx) => {
  ctx.reply(
    "What would you like to do today?",
    Markup.inlineKeyboard([
      [Markup.button.callback("Create a room", "CreateRoom")],
      [Markup.button.callback("Join an existing room", "ExistingRoom")],
    ])
  );
});
createRoom();
bot.action("CreateRoom", (ctx) => {
  ctx.deleteMessage();

  ctx.reply("Creating room...");
});

bot.launch();

// Enable graceful stop
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
