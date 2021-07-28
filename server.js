const { Telegraf, Markup } = require("telegraf");
const { oneLine } = require("common-tags");
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

bot.action("CreateRoom", async (ctx) => {
  //   ctx.deleteMessage();
  const { message_id } = await ctx.reply("Creating room...");

  const name = (await ctx.getChat()).first_name;
  const room_key = await createRoom(name);
  ctx.deleteMessage(message_id);
  await ctx.reply(oneLine`
    Room has been created! Share the passcode with your friends for them to
    join the room. The passcode for the room is:`);
  ctx.replyWithHTML(`<b>${room_key}</b>`);
});

bot.launch();

// Enable graceful stop
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
