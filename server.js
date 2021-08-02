const { Telegraf, Markup } = require("telegraf");
const { oneLine } = require("common-tags");
const {
  registerUser,
  createRoom,
  joinRoom,
  getRoomPlayers,
  updateTally,
  updateMenu,
  previousMenu,
} = require("./db");
require("dotenv").config();

// TODO: app crashes if user sends password immediately without sending /start
// TODO: host settings => shooter or normal, money,
// TODO: undo mistake
// TODO: pressing "Back" means player leaves the room
const bot = new Telegraf(process.env.TOKEN);

const getPreviousMenu = async (ctx, skips) => {
  try {
    ctx.deleteMessage();
    const { id } = await ctx.getChat();
    await updateMenu(id, ctx.match.input);
    return await previousMenu(id, skips);
  } catch (err) {
    console.log(err);
  }
};

bot.start((ctx) => startMenu(ctx));
bot.action("Start", (ctx) => startMenu(ctx));

const startMenu = async (ctx) => {
  ctx.deleteMessage();

  const { id, first_name, username } = await ctx.getChat();
  await registerUser(id, first_name, username);
  ctx.reply(
    "What would you like to do today?",
    Markup.inlineKeyboard([
      [Markup.button.callback("Create a room", "CreateRoom")],
      [Markup.button.callback("Join an existing room", "JoinRoom")],
    ])
  );
  await updateMenu(id, "Start");
};

bot.action("CreateRoom", async (ctx) => {
  const previousMenu = await getPreviousMenu(ctx, 1);
  const { message_id } = await ctx.reply("Creating room...");

  const { id, first_name, username } = await ctx.getChat();
  const passcode = await createRoom(id, first_name, username);
  ctx.deleteMessage(message_id);

  await ctx.replyWithHTML(
    oneLine`
    Room has been created! Share the passcode with your friends for them to
    join the room. The passcode for the room is:
    <b>${passcode}</b>`,
    Markup.inlineKeyboard([[Markup.button.callback("🔙 Back", previousMenu)]])
  );
});

bot.action("JoinRoom", async (ctx) => {
  const previousMenu = await getPreviousMenu(ctx, 1);
  ctx.reply(
    "Please key in the 6-letter passcode below.", // TODO: delete this message
    Markup.inlineKeyboard([[Markup.button.callback("🔙 Back", previousMenu)]])
  );
});

// Passcode
bot.hears(/^[a-z]{6}$/, async (ctx) => {
  // TODO can't join another room if the player is already in a room

  const previousMenu = await getPreviousMenu(ctx, 1);
  const { id, first_name, username } = await ctx.getChat();
  //   const { id, first_name } = { id: 1001, first_name: "test" };
  const passcode = ctx.match.input;
  const response = await joinRoom(id, first_name, username, passcode);

  if (response.error === "No such room") {
    ctx.reply(
      "Room does not exist.",
      Markup.inlineKeyboard([[Markup.button.callback("🔙 Back", previousMenu)]])
    );
  } else if (response.error === "Room full") {
    ctx.reply(
      "Room is full. Please join another room or create a new room.",
      Markup.inlineKeyboard([[Markup.button.callback("🔙 Back", previousMenu)]])
    );
  } else if (response.error === "Player exists") {
    ctx.reply(
      "You have already joined the room.",
      Markup.inlineKeyboard([[Markup.button.callback("🔙 Back", previousMenu)]])
    );
  } else {
    ctx.reply(oneLine`You have succesfully joined the room! Please wait for the
      host to start the game.`);
    ctx.telegram.sendMessage(
      response.hostId,
      `${first_name} has joined the room.`,
      Markup.inlineKeyboard([
        [Markup.button.callback("Start game", "StartGame")], // TODO only show when there are 4 players
        [Markup.button.callback("🔙 Back", previousMenu)],
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
  await getPreviousMenu(ctx, 1);
  const { id } = await ctx.getChat();
  const playerIds = await getRoomPlayers(id);

  playerIds.forEach((player) => {
    // TODO: sent to each player when player presses back
    ctx.telegram.sendMessage(
      player.chatId,
      "The game has began! What would you like to do?",
      Markup.inlineKeyboard([
        [Markup.button.callback("Pay", "Pay")],
        [Markup.button.callback("View tally", "ViewTally")],
        [Markup.button.callback("Undo payment", "UndoPayment")],
      ])
    );
  });
});

// Pay menu
bot.action("Pay", async (ctx) => {
  const previousMenu = await getPreviousMenu(ctx, 1);
  ctx.reply(
    "How much did you win by?",
    Markup.inlineKeyboard([
      [Markup.button.callback("1️⃣ Tai", "Pay_1 Tai")],
      [Markup.button.callback("2️⃣ Tai", "Pay_2 Tai")],
      [Markup.button.callback("3️⃣ Tai", "Pay_3 Tai")],
      [Markup.button.callback("4️⃣ Tai", "Pay_4 Tai")],
      [Markup.button.callback("5️⃣ Tai", "Pay_5 Tai")],
      [Markup.button.callback("Bite", "Pay_Bite")],
      [Markup.button.callback("Double Bite", "Pay_Double Bite")],
      [Markup.button.callback("Kong", "Pay_Kong")],
      [Markup.button.callback("Matching Flowers", "Pay_Matching Flowers")],
      [Markup.button.callback("🔙 Back", previousMenu)],
    ])
  );
});

bot.action(/Pay_.+/, async (ctx) => {
  const type = ctx.match.input.split("_")[1];
  const { id } = await ctx.getChat();
  const players = await getRoomPlayers(id);

  // Bite and Hidden Bite / Hidden Kong reduces everyones winnings immediately
  if (type === "Bite" || type === "Double Bite") {
    updateTally(type, null, id);
    return ctx.answerCbQuery(`Tally updated with ${type} winnings`);
  }

  const previousMenu = await getPreviousMenu(ctx, 1);
  const buttons = players.reduce((accumulator, player) => {
    if (player.chatId !== id) {
      accumulator.push([
        Markup.button.callback(
          `${player.name} (${player.username})`,
          `${type}_${player.chatId}`
        ),
      ]);
    }
    return accumulator;
  }, []);

  if (type !== "Matching Flowers") {
    buttons.push([Markup.button.callback("Zimo", `Zimo ${type}_null`)]);
  }

  buttons.push([Markup.button.callback("🔙 Back", previousMenu)]);

  ctx.reply("Who shot the tile?", Markup.inlineKeyboard(buttons));
});

bot.action(/[a-zA-Z\s]+_(\d{9}|null)/, async (ctx) => {
  const [type, shooterId] = ctx.match.input.split("_");
  const { id } = await ctx.getChat();
  updateTally(type, shooterId, id);
  return ctx.answerCbQuery(`Tally updated with ${type} winnings`);
});

// View tally
bot.action("ViewTally", async (ctx) => {
  const previousMenu = await getPreviousMenu(ctx, 1);
  const { id } = await ctx.getChat();
  const players = await getRoomPlayers(id);

  ctx.replyWithHTML(
    players.reduce(
      (accumulator, player) =>
        accumulator +
        `<b>${player.name}</b> (${player.username}): $${player.tally.toFixed(
          2
        )}\n`,
      ""
    ),
    Markup.inlineKeyboard([[Markup.button.callback("🔙 Back", previousMenu)]])
  );
});

bot.launch();

// Enable graceful stop
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
