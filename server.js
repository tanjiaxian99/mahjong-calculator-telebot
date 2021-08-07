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
  updateActionHistory,
  getActionHistory,
  updateTally,
  getIsShooter,
  updateIsShooter,
  getWinningSystem,
  setWinningSystem,
  updateMenu,
  previousMenu,
} = require("./db");
const winningSystems = require("./winningSystems");
require("dotenv").config();

// TODO: history
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
      [Markup.button.callback("View winning system", "ViewWinningSystem")],
      [Markup.button.callback("View history", "ViewHistory")],
    ];

    if (player.chatId === hostId) {
      buttons.push([Markup.button.callback("⚙️ Settings", "Settings")]);
      buttons.push([Markup.button.callback("❌ Delete room", "DeleteRoom")]);
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
    [Markup.button.callback("Undo payment", "Undo")],
    [Markup.button.callback("View winning system", "ViewWinningSystem")],
    [Markup.button.callback("View history", "ViewHistory")],
  ];

  if (id === hostId) {
    buttons.push([Markup.button.callback("⚙️ Settings", "Settings")]);
    buttons.push([Markup.button.callback("❌ Delete room", "DeleteRoom")]);
  }

  const { message_id } = await ctx.reply(
    "The game has began! What would you like to do?",
    Markup.inlineKeyboard(buttons)
  );

  await deleteMessageIdHistory(id);
  await updateMessageIdHistory(id, message_id);
});

// Pay menu
bot.action(/^(Pay|Undo)$/, async (ctx) => {
  ctx.deleteMessage();
  const payOrUndo = ctx.match.input;
  const previousMenu = await getPreviousMenu(ctx, 1);
  const { id } = await ctx.getChat();

  const { message_id } = await ctx.reply(
    payOrUndo === "Pay"
      ? "How much did you win by?"
      : "Which payment would you like to undo?",
    Markup.inlineKeyboard([
      [Markup.button.callback("1️⃣ Tai", `${payOrUndo}_1 Tai`)],
      [Markup.button.callback("2️⃣ Tai", `${payOrUndo}_2 Tai`)],
      [Markup.button.callback("3️⃣ Tai", `${payOrUndo}_3 Tai`)],
      [Markup.button.callback("4️⃣ Tai", `${payOrUndo}_4 Tai`)],
      [Markup.button.callback("5️⃣ Tai", `${payOrUndo}_5 Tai`)],
      [Markup.button.callback("Bite", `${payOrUndo}_Bite`)],
      [Markup.button.callback("Double Bite", `${payOrUndo}_Double Bite`)],
      [Markup.button.callback("Kong", `${payOrUndo}_Kong`)],
      [
        Markup.button.callback(
          "Matching Flowers",
          `${payOrUndo}_Matching Flowers`
        ),
      ],
      [
        Markup.button.callback(
          "Hidden Matching Flowers",
          `${payOrUndo}_Hidden Matching Flowers`
        ),
      ],
      [Markup.button.callback("🔙 Back", previousMenu)],
    ])
  );

  await deleteMessageIdHistory(id);
  await updateMessageIdHistory(id, message_id);
});

bot.action(/^(Pay|Undo)_[a-zA-Z0-9 ]+$/, async (ctx) => {
  const [payOrUndo, type] = ctx.match.input.split("_");
  const { id, first_name, username } = await ctx.getChat();
  const players = await getRoomPlayers(id);

  // Bite and Hidden Bite / Hidden Kong reduces everyones winnings immediately
  if (type === "Bite" || type === "Double Bite") {
    updateTally(payOrUndo, type, null, id);
    updateActionHistory(
      id,
      `${first_name} (${username}) got ${type} money from everyone`
    );
    return ctx.answerCbQuery(`Tally updated with ${type} winnings`);
  }

  ctx.deleteMessage();
  const previousMenu = await getPreviousMenu(ctx, 1);
  const message =
    type === "Matching Flowers" || type === "Hidden Matching Flowers"
      ? "Whose flowers do they belong to?"
      : "Who shot the tile?";

  const buttons = players.reduce((accumulator, player) => {
    if (player.chatId !== id) {
      accumulator.push([
        Markup.button.callback(
          `${player.name} (${player.username})`,
          `${payOrUndo}_${type}_${player.chatId}`
        ),
      ]);
    }
    return accumulator;
  }, []);

  if (type !== "Matching Flowers" && type !== "Hidden Matching Flowers") {
    buttons.push([
      Markup.button.callback("Zimo", `${payOrUndo}_Zimo ${type}_null`),
    ]);
  }
  buttons.push([Markup.button.callback("🔙 Back", previousMenu)]);

  const { message_id } = await ctx.reply(
    message,
    Markup.inlineKeyboard(buttons)
  );

  await deleteMessageIdHistory(id);
  await updateMessageIdHistory(id, message_id);
});

bot.action(/(Pay|Undo)_[a-zA-Z0-9 ]+_(\d{9}|null)/, async (ctx) => {
  const [payOrUndo, type, shooterId] = ctx.match.input.split("_");
  const { id, first_name, username } = await ctx.getChat();
  const players = await getRoomPlayers(id);
  const shooter = players.find(
    (player) => player.chatId === parseInt(shooterId)
  );

  updateTally(payOrUndo, type, shooterId, id);
  let action = `${first_name} (${username}) won ${type} money ${
    shooterId === "null"
      ? "from everyone"
      : type === "Matching Flowers" || type === "Hidden Matching Flowers"
      ? `from ${shooter.name} (${shooter.username})`
      : `with ${shooter.name} (${shooter.username}) as the shooter`
  }`;

  if (payOrUndo === "Undo") {
    action = `<del>${action}</del>`;
  }
  updateActionHistory(id, action);

  return ctx.answerCbQuery(
    payOrUndo === "Pay"
      ? `Tally updated with ${type} winnings`
      : `Undid ${type} winnings`
  );
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

// View winning system
bot.action("ViewWinningSystem", async (ctx) => {
  ctx.deleteMessage();
  const previousMenu = await getPreviousMenu(ctx, 1);
  const { id } = await ctx.getChat();
  const shooter = await getIsShooter(id);
  const winningSystem = await getWinningSystem(id);

  ctx.replyWithHTML(
    stripIndents`<pre>
      Current game mode: ${shooter ? "Shooter" : "Non-Shooter"}
      
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

// View history
bot.action("ViewHistory", async (ctx) => {
  ctx.deleteMessage();
  const previousMenu = await getPreviousMenu(ctx, 1);
  const { id } = await ctx.getChat();
  const actionHistory = await getActionHistory(id);

  ctx.replyWithHTML(
    actionHistory.length === 0
      ? "No history to be shown"
      : actionHistory.reduce(
          (accumulator, action, index) =>
            accumulator + `${index + 1}. ${action}\n`,
          ""
        ),
    Markup.inlineKeyboard([
      [Markup.button.callback("🔄 Refresh", ctx.match.input)],
      [Markup.button.callback("🔙 Back", previousMenu)],
    ])
  );
});

// Settings
bot.action("Settings", async (ctx) => {
  ctx.deleteMessage();
  const previousMenu = await getPreviousMenu(ctx, 1);

  await ctx.reply(
    "Which setting would you like to adjust?",
    Markup.inlineKeyboard([
      [
        Markup.button.callback(
          "Set shooter or non-shooter",
          "ShooterOrNonShooter"
        ),
      ],
      [Markup.button.callback("Set winning system", "SetWinningSystem")],
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
      [Markup.button.callback("Non-Shooter", "false")],
      [Markup.button.callback("🔙 Back", previousMenu)],
    ])
  );
});

bot.action(/true|false/, async (ctx) => {
  const isShooter = ctx.match.input === "true";
  const { id } = await ctx.getChat();
  updateIsShooter(id, isShooter);
  updateActionHistory(
    id,
    `Updated game mode to ${isShooter ? "Shooter" : "Non-Shooter"}`
  );

  return ctx.answerCbQuery(
    `Game is set to ${isShooter ? "Shooter" : "Non-Shooter"} mode`
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
  const systemName = ctx.match.input.split("_")[1];
  const { id } = await ctx.getChat();
  setWinningSystem(id, systemName);

  const systems = {
    tenTwenty: "0.1 / 0.2",
    twentyFourty: "0.2 / 0.4",
    threeSixHalf: "0.3 / 0.6 half",
    fiftyOne: "0.5 / 1",
    threeSix: "0.3 / 0.6",
    oneTwo: "1 / 2",
  };

  const winningSystem = winningSystems[systemName];

  updateActionHistory(
    id,
    stripIndents`Updated winning system to <pre>    
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
    </pre>`
  );

  return ctx.answerCbQuery(`Winning system is set to ${systems[systemName]}`);
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
      Winning System: <pre>
      |  Tai  | Base | Zimo |
      | 1 Tai | $0.5 | $1   |
      | 2 Tai | $1   | $1.5 |
      | 3 Tai | $1.5 | $2.5 |
      | 4 Tai | $2.5 | $5   |
      | 5 Tai | $5   | $10  |
      </pre>
      Input: <code>2 4 4 8 8 16 16 32 32 64</code>
      Winning System: <pre>
      |  Tai  | Base | Zimo |
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

// Custom winning system
bot.hears(
  /((\d\d\.\d\d|\d\.\d\d|\d\.\d|\d\d\d|\d\d|\d)\s){9}(\d\d\.\d\d|\d\.\d\d|\d\.\d|\d\d\d|\d\d|\d)/,
  async (ctx) => {
    ctx.deleteMessage();
    const { id } = await ctx.getChat();
    let numbers = ctx.match.input.split(" ");
    numbers = numbers.map((number) => parseInt(number));

    const messageIdHistory = await deleteMessageIdHistory(id);
    messageIdHistory.forEach((messageId) => ctx.deleteMessage(messageId));
    const previousMenu = await getPreviousMenu(ctx, 1);

    const winningSystem = {
      oneTai: {
        base: numbers[0],
        zimo: numbers[1],
      },
      twoTai: {
        base: numbers[2],
        zimo: numbers[3],
      },
      threeTai: {
        base: numbers[4],
        zimo: numbers[5],
      },
      fourTai: {
        base: numbers[6],
        zimo: numbers[7],
      },
      fiveTai: {
        base: numbers[8],
        zimo: numbers[9],
      },
    };
    setWinningSystem(id, winningSystem);

    const { message_id } = await ctx.reply(
      "Custom winning system successfully set.",
      Markup.inlineKeyboard([[Markup.button.callback("🔙 Back", previousMenu)]])
    );
    updateMessageIdHistory(id, message_id);
    updateActionHistory(
      id,
      stripIndents`Updated winning system to <pre>    
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
      </pre>`
    );
  }
);

// Invalid texts
bot.on("text", (ctx) => {
  ctx.reply("Unrecognised text");
});

bot.launch();

// Enable graceful stop
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
