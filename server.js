const { Telegraf, Markup } = require("telegraf");
const { oneLine } = require("common-tags");
const { createRoom, joinRoom, getRoomPlayers, getTally } = require("./db");
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

  const { id, first_name, username } = await ctx.getChat();
  const passcode = await createRoom(id, first_name, username);
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
  // TODO can't join another room if the player is already in a room

  const { id, first_name, username } = await ctx.getChat();
  //   const { id, first_name } = { id: 1001, first_name: "test" };
  const passcode = ctx.match.input;
  const response = await joinRoom(id, first_name, username, passcode);

  if (response.error === "No such room") {
    ctx.reply("Room does not exist.");
  } else if (response.error === "Room full") {
    ctx.reply("Room is full. Please join another room or create a new room.");
  } else if (response.error === "Player exists") {
    ctx.reply("You have already joined the room.");
  } else {
    ctx.reply(oneLine`You have succesfully joined the room! Please wait for the
      host to start the game.`);
    ctx.telegram.sendMessage(
      response.hostId,
      `${first_name} has joined the room.`,
      Markup.inlineKeyboard([
        [Markup.button.callback("Start game", "StartGame")], // TODO only show when there are 4 players
      ])
    );
  }
});

// Passcode of invalid format
bot.on("text", (ctx) => {
  ctx.reply(
    "Invalid passcode format. Passcode should consists of 6 lower-case letters."
  );
});

// Start game
bot.action("StartGame", async (ctx) => {
  ctx.deleteMessage();

  const { id } = await ctx.getChat();
  const playerIds = await getRoomPlayers(id);

  playerIds.forEach((playerId) => {
    ctx.telegram.sendMessage(
      playerId,
      "The game has began! What would you like to do?",
      Markup.inlineKeyboard([
        [Markup.button.callback("Pay", "Pay")],
        [Markup.button.callback("View tally", "ViewTally")],
      ])
    );
  });
});

bot.action("Pay", async (ctx) => {});

// View tally
bot.action("ViewTally", async (ctx) => {
  const { id } = await ctx.getChat();
  const totalTally = await getTally(id);
  ctx.replyWithHTML(
    totalTally.reduce(
      (accumulator, currentValue) =>
        accumulator +
        `<b>${currentValue.name}</b> (${currentValue.username}): $${currentValue.tally}\n`,
      ""
    )
  );
});

bot.launch();

// Enable graceful stop
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
