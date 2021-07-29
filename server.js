const { Telegraf, Markup } = require("telegraf");
const { oneLine } = require("common-tags");
const { createRoom, joinRoom } = require("./db");
require("dotenv").config();

const bot = new Telegraf(process.env.TOKEN);

bot.start((ctx) => {
  ctx.reply(
    "What would you like to do today?",
    Markup.inlineKeyboard([
      [Markup.button.callback("Create a room", "CreateRoom")],
      [Markup.button.callback("Join an existing room", "JoinRoom")],
    ])
  );
});

bot.action("CreateRoom", async (ctx) => {
  //   ctx.deleteMessage();
  const { message_id } = await ctx.reply("Creating room...");

  const { id, first_name } = await ctx.getChat();
  const passcode = await createRoom(id, first_name);
  ctx.deleteMessage(message_id);

  await ctx.reply(oneLine`
    Room has been created! Share the passcode with your friends for them to
    join the room. The passcode for the room is:`);
  ctx.replyWithHTML(`<b>${passcode}</b>`);
});

bot.action("JoinRoom", async (ctx) => {
  ctx.reply("Please key in the 6-letter passcode below.");
});

// Passcode
bot.hears(/^[a-z]{6}$/, async (ctx) => {
  //   const { id, first_name } = await ctx.getChat();
  const { id, first_name } = { id: 1001, first_name: "test" };
  const passcode = ctx.match.input;
  const players = await joinRoom(id, first_name, passcode);
  console.log(players);
});

bot.launch();

// Enable graceful stop
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
