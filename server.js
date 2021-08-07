const { Telegraf, Markup } = require("telegraf");
const { oneLine, stripIndents } = require("common-tags");
const {
  registerUser,
  createRoom,
  updateMessageIdHistory,
  deleteMessageIdHistory,
  joinRoom,
  leaveRoom,
  getHostId,
  getRoomPlayers,
  updateTally,
  updateIsShooter,
  getWinningSystem,
  setWinningSystem,
  updateMenu,
  previousMenu,
} = require("./db");
require("dotenv").config();

// TODO: host settings =>  winning system
// TODO: undo mistake
const bot = new Telegraf(process.env.TOKEN);

const getPreviousMenu = async (ctx, skips) => {
  try {
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
  const { id, first_name, username } = await ctx.getChat();
  const messageIdHistory = await deleteMessageIdHistory(id);
  if (messageIdHistory !== undefined) {
    messageIdHistory.forEach((messageId) => ctx.deleteMessage(messageId));
  }

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
  ctx.deleteMessage();
  const previousMenu = await getPreviousMenu(ctx, 1);
  let { message_id } = await ctx.reply("Creating room...");

  const { id, first_name, username } = await ctx.getChat();
  const passcode = await createRoom(id, first_name, username);
  ctx.deleteMessage(message_id);

  ({ message_id } = await ctx.replyWithHTML(
    oneLine`
    Room has been created! Share the passcode with your friends for them to
    join the room. The passcode for the room is:
    <b>${passcode}</b>`,
    Markup.inlineKeyboard([
      [Markup.button.callback("❌ Delete room", "DeleteRoom")],
    ])
  ));
  updateMessageIdHistory(id, message_id);
});

bot.action("JoinRoom", async (ctx) => {
  ctx.deleteMessage();
  const previousMenu = await getPreviousMenu(ctx, 1);
  const { id } = await ctx.getChat();
  const { message_id } = await ctx.reply(
    "Please key in the 6-letter passcode below.",
    Markup.inlineKeyboard([[Markup.button.callback("🔙 Back", previousMenu)]])
  );
  await updateMessageIdHistory(id, message_id);
});

// Passcode
bot.hears(/^[a-z]{6}$/, async (ctx) => {
  ctx.deleteMessage();
  const { id, first_name, username } = await ctx.getChat();
  const passcode = ctx.match.input;
  const response = await joinRoom(id, first_name, username, passcode);

  if (response.error === "Unregistered user") {
    ctx.reply("Send /start first before entering the passcode.");
    return;
  }

  const messageIdHistory = await deleteMessageIdHistory(id);
  messageIdHistory.forEach((messageId) => ctx.deleteMessage(messageId));
  const previousMenu = await getPreviousMenu(ctx, 1);

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
      Markup.inlineKeyboard([
        [Markup.button.callback("Leave room", "LeaveRoom")],
      ])
    );
  } else {
    let { message_id } = await ctx.reply(
      oneLine`You have succesfully joined the room! Please wait for the
      host to start the game.`,
      Markup.inlineKeyboard([
        [Markup.button.callback("Leave room", "LeaveRoom")],
      ])
    );
    await updateMessageIdHistory(id, message_id);

    ({ message_id } = await ctx.telegram.sendMessage(
      response.hostId,
      `${first_name} has joined the room.`,
      Markup.inlineKeyboard([
        [Markup.button.callback("Start game", "StartGame")], // TODO only show when there are 4 players
      ])
    ));
    await updateMessageIdHistory(response.hostId, message_id);
  }
});

bot.action("LeaveRoom", async (ctx) => {
  const { id, first_name } = await ctx.getChat();
  const hostId = await getHostId(id);
  await leaveRoom(id);

  const { message_id } = await ctx.telegram.sendMessage(
    hostId,
    `${first_name} has left the room.`
  );
  updateMessageIdHistory(hostId, message_id);
  await startMenu(ctx);
  return;
});

bot.action("DeleteRoom", async (ctx) => {
  const { id, first_name } = await ctx.getChat();
  const hostId = await getHostId(id);
  const players = await getRoomPlayers(id);
  await leaveRoom(id);

  for (const player of players) {
    if (player.chatId !== hostId) {
      await leaveRoom(player.chatId);
      const messageIdHistory = await deleteMessageIdHistory(player.chatId);
      messageIdHistory.forEach((messageId) => {
        ctx.telegram.deleteMessage(player.chatId, messageId);
      });

      const { message_id } = await ctx.telegram.sendMessage(
        player.chatId,
        `${first_name} has deleted the room.`,
        Markup.inlineKeyboard([
          [Markup.button.callback("🔙 Back to main menu", "Start")],
        ])
      );
      updateMessageIdHistory(player.chatId, message_id);
    }
  }

  const messageIdHistory = await deleteMessageIdHistory(id);
  messageIdHistory.forEach((messageId) => {
    ctx.deleteMessage(messageId);
  });
  await startMenu(ctx);
});

// Invalid texts
bot.on("text", (ctx) => {
  ctx.reply("Unrecognised text");
});

// Sends game menu to all players when the host starts the game
bot.action("StartGame", async (ctx) => {
  const { id } = await ctx.getChat();
  const hostId = await getHostId(id);
  const players = await getRoomPlayers(id);

  for (const player of players) {
    const messageIdHistory = await deleteMessageIdHistory(player.chatId);
    messageIdHistory.forEach((messageId) =>
      ctx.telegram.deleteMessage(player.chatId, messageId)
    );

    const buttons = [
      [Markup.button.callback("Pay", "Pay")],
      [Markup.button.callback("View tally", "ViewTally")],
      [Markup.button.callback("Undo payment", "UndoPayment")],
    ];

    if (player.chatId === hostId) {
      buttons.push([Markup.button.callback("⚙️ Settings", "Settings")]);
      buttons.push([Markup.button.callback("❌ Delete room", "DeleteRoom")]);
    } else {
      buttons.push([
        Markup.button.callback("View winning system", "ViewWinningSystem"),
      ]);
    }

    const { message_id } = await ctx.telegram.sendMessage(
      player.chatId,
      "The game has began! What would you like to do?",
      Markup.inlineKeyboard(buttons)
    );

    updateMenu(player.chatId, "Game");
    updateMessageIdHistory(player.chatId, message_id);
  }
});

// Game menu
bot.action("Game", async (ctx) => {
  ctx.deleteMessage();
  await getPreviousMenu(ctx, 1);
  const { id } = await ctx.getChat();
  const hostId = await getHostId(id);

  const buttons = [
    [Markup.button.callback("Pay", "Pay")],
    [Markup.button.callback("View tally", "ViewTally")],
    [Markup.button.callback("Undo payment", "UndoPayment")],
  ];

  if (id === hostId) {
    buttons.push([Markup.button.callback("⚙️ Settings", "Settings")]);
    buttons.push([Markup.button.callback("❌ Delete room", "DeleteRoom")]);
  } else {
    buttons.push([
      Markup.button.callback("View winning system", "ViewWinningSystem"),
    ]);
  }

  const { message_id } = await ctx.reply(
    "The game has began! What would you like to do?",
    Markup.inlineKeyboard(buttons)
  );

  await deleteMessageIdHistory(id);
  await updateMessageIdHistory(id, message_id);
});

// Pay menu
bot.action("Pay", async (ctx) => {
  ctx.deleteMessage();
  const previousMenu = await getPreviousMenu(ctx, 1);
  const { id } = await ctx.getChat();

  const { message_id } = await ctx.reply(
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
      [
        Markup.button.callback(
          "Hidden Matching Flowers",
          "Pay_Hidden Matching Flowers"
        ),
      ],
      [Markup.button.callback("🔙 Back", previousMenu)],
    ])
  );

  await deleteMessageIdHistory(id);
  await updateMessageIdHistory(id, message_id);
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

  ctx.deleteMessage();
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

  if (type !== "Matching Flowers" && type !== "Hidden Matching Flowers") {
    buttons.push([Markup.button.callback("Zimo", `Zimo ${type}_null`)]);
  }
  buttons.push([Markup.button.callback("🔙 Back", previousMenu)]);

  const message =
    type === "Matching Flowers" || type === "Hidden Matching Flowers"
      ? "Whose flowers do they belong to?"
      : "Who shot the tile?";

  const { message_id } = await ctx.reply(
    message,
    Markup.inlineKeyboard(buttons)
  );

  await deleteMessageIdHistory(id);
  await updateMessageIdHistory(id, message_id);
});

bot.action(/[a-zA-Z\s]+_(\d{9}|null)/, async (ctx) => {
  const [type, shooterId] = ctx.match.input.split("_");
  const { id } = await ctx.getChat();
  updateTally(type, shooterId, id);
  return ctx.answerCbQuery(`Tally updated with ${type} winnings`);
});

// View tally
bot.action("ViewTally", async (ctx) => {
  ctx.deleteMessage();
  const previousMenu = await getPreviousMenu(ctx, 1);
  const { id } = await ctx.getChat();
  const players = await getRoomPlayers(id);

  const { message_id } = await ctx.replyWithHTML(
    players.reduce(
      (accumulator, player) =>
        accumulator +
        `<b>${player.name}</b> (${player.username}): $${player.tally.toFixed(
          2
        )}\n`,
      ""
    ),
    Markup.inlineKeyboard([
      [Markup.button.callback("🔄 Refresh", ctx.match.input)],
      [Markup.button.callback("🔙 Back", previousMenu)],
    ])
  );

  await deleteMessageIdHistory(id);
  await updateMessageIdHistory(id, message_id);
});

// Settings
bot.action("Settings", async (ctx) => {
  ctx.deleteMessage();
  const previousMenu = await getPreviousMenu(ctx, 1);

  await ctx.reply(
    "Which setting would you like to adjust?",
    Markup.inlineKeyboard([
      [Markup.button.callback("Shooter or non-shooter", "ShooterOrNonShooter")],
      [Markup.button.callback("Winning System", "WinningSystem")],
      [Markup.button.callback("🔙 Back", previousMenu)],
    ])
  );
});

// Normal or Shooter
bot.action("ShooterOrNonShooter", async (ctx) => {
  ctx.deleteMessage();
  const previousMenu = await getPreviousMenu(ctx, 1);

  ctx.reply(
    "Is the game shooter or non-shooter?",
    Markup.inlineKeyboard([
      [Markup.button.callback("Shooter", "true")],
      [Markup.button.callback("Non-shooter", "false")],
      [Markup.button.callback("🔙 Back", previousMenu)],
    ])
  );
});

bot.action(/true|false/, async (ctx) => {
  const isShooter = ctx.match.input === "true";
  const { id } = await ctx.getChat();
  updateIsShooter(id, isShooter);

  return ctx.answerCbQuery(
    `Game is set to ${isShooter ? "Shooter" : "Non-shooter"} mode` // TODO show tick icon beside the current setting
  );
});

bot.action("WinningSystem", async (ctx) => {
  ctx.deleteMessage();
  const previousMenu = await getPreviousMenu(ctx, 1);

  ctx.reply(
    "Would you like to view or set the winning system?",
    Markup.inlineKeyboard([
      [Markup.button.callback("View winning system", "ViewWinningSystem")],
      [Markup.button.callback("Set winning system", "SetWinningSystem")],
      [Markup.button.callback("🔙 Back", previousMenu)],
    ])
  );
});

bot.action("ViewWinningSystem", async (ctx) => {
  ctx.deleteMessage();
  const previousMenu = await getPreviousMenu(ctx, 1);
  const { id } = await ctx.getChat();
  const winningSystem = await getWinningSystem(id);

  ctx.replyWithHTML(
    stripIndents`<pre>
      |  Tai  | Base | Zimo |
      |-------|------|------|
      | 1 Tai | $${winningSystem.oneTai.base
        .toString()
        .padEnd(3)} | $${winningSystem.oneTai.zimo.toString().padEnd(3)} |
      | 2 Tai | $${winningSystem.twoTai.base
        .toString()
        .padEnd(3)} | $${winningSystem.twoTai.zimo.toString().padEnd(3)} |
      | 3 Tai | $${winningSystem.threeTai.base
        .toString()
        .padEnd(3)} | $${winningSystem.threeTai.zimo.toString().padEnd(3)} |
      | 4 Tai | $${winningSystem.fourTai.base
        .toString()
        .padEnd(3)} | $${winningSystem.fourTai.zimo.toString().padEnd(3)} |
      | 5 Tai | $${winningSystem.fiveTai.base
        .toString()
        .padEnd(3)} | $${winningSystem.fiveTai.zimo.toString().padEnd(3)} |
    </pre>`,
    Markup.inlineKeyboard([[Markup.button.callback("🔙 Back", previousMenu)]])
  );
});

bot.action("SetWinningSystem", async (ctx) => {
  ctx.deleteMessage();
  const previousMenu = await getPreviousMenu(ctx, 1);

  ctx.reply(
    "Which winning system would you like to set?",
    Markup.inlineKeyboard([
      [Markup.button.callback("0.1 / 0.2", "SetWinningSystem_tenTwenty")],
      [Markup.button.callback("0.2 / 0.4", "SetWinningSystem_twentyFourty")],
      [
        Markup.button.callback(
          "0.3 / 0.6 half",
          "SetWinningSystem_threeSixHalf"
        ),
      ],
      [Markup.button.callback("0.5 / 1", "SetWinningSystem_fiftyOne")],
      [Markup.button.callback("0.3 / 0.6", "SetWinningSystem_threeSix")],
      [Markup.button.callback("1 / 2", "SetWinningSystem_oneTwo")],
      [Markup.button.callback("Custom", "CustomWinningSystem")],
      [Markup.button.callback("🔙 Back", previousMenu)],
    ])
  );
});

bot.action(/SetWinningSystem_\w+/, async (ctx) => {
  const selectedSystem = ctx.match.input.split("_")[1];
  const { id } = await ctx.getChat();
  setWinningSystem(id, selectedSystem);

  const systems = {
    tenTwenty: "0.1 / 0.2",
    twentyFourty: "0.2 / 0.4",
    threeSixHalf: "0.3 / 0.6 half",
    fiftyOne: "0.5 / 1",
    threeSix: "0.3 / 0.6",
    oneTwo: "1 / 2",
  };

  return ctx.answerCbQuery(
    `Winning system is set to ${systems[selectedSystem]}`
  );
});

bot.action("CustomWinningSystem", async (ctx) => {
  ctx.deleteMessage();
  const previousMenu = await getPreviousMenu(ctx, 1);
  const { id } = await ctx.getChat();
  const players = await getRoomPlayers(id);

  const { message_id } = await ctx.replyWithHTML(
    oneLine`
      Type a custom winning system below. The format of the input is as follows:` +
      "\n\n" +
      oneLine`
      Key in 10 numbers, each with a space in between. The first number refers to
      1 Tai Base, the second number refers to 1 Tai Zimo, the third number refers to
      2 Tai Base, and so on. Here are some examples:` +
      "\n\n" +
      stripIndents`
      Input: <code>0.5 1 1 1.5 1.5 2.5 2.5 5 5 10</code>
      Winning System: <pre>|  Tai  | Base | Zimo |
      | 1 Tai | $0.5 | $1   |
      | 2 Tai | $1   | $1.5 |
      | 3 Tai | $1.5 | $2.5 |
      | 4 Tai | $2.5 | $5   |
      | 5 Tai | $5   | $10  |
      </pre>

      Input: <code>2 4 4 8 8 16 16 32 32 64</code>
      Winning System: <pre>|  Tai  | Base | Zimo |
      | 1 Tai | $2   | $4   |
      | 2 Tai | $4   | $8   |
      | 3 Tai | $8   | $16  |
      | 4 Tai | $16  | $32  |
      | 5 Tai | $32  | $64  |
      </pre>
    `,
    Markup.inlineKeyboard([[Markup.button.callback("🔙 Back", previousMenu)]])
  );

  await deleteMessageIdHistory(id);
  await updateMessageIdHistory(id, message_id);
});

bot.launch();

// Enable graceful stop
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
