const mongoose = require("mongoose");
const fetch = require("node-fetch");
require("dotenv").config();

const uri =
  process.env.NODE_ENV === "development"
    ? "mongodb://localhost:27017/mahjong-winnings"
    : process.env.MONGODB_URI;

mongoose.connect(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  useCreateIndex: true,
  useFindAndModify: false,
});

const db = mongoose.connection;
db.on("error", console.error.bind(console, "connection error:"));
db.once("open", () => {
  console.log("Database connected!");
});

const wrapper = (f) => {
  return async function () {
    try {
      return await f.apply(this, arguments);
    } catch (e) {
      console.log(e);
    }
  };
};

const registerUser = async (chatId, name, username) => {
  const users = await db.collection("users");
  await users.updateOne(
    { chatId },
    { $set: { chatId, name, username } },
    { upsert: true }
  );
};

const createRoom = async (chatId, name, username) => {
  let res = await fetch("https://api.random.org/json-rpc/4/invoke", {
    method: "post",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "generateStrings",
      params: [
        "ce0c662c-ae13-4e37-a551-e2aacab7de2c",
        1,
        6,
        "abcdefghijklmnopqrstuvwxyz",
      ],
      id: 42,
    }),
  });
  res = await res.json();
  const [passcode] = res.result.random.data;

  const users = db.collection("users");
  const rooms = db.collection("rooms");
  await users.updateOne(
    { chatId },
    { $set: { name, username, passcode, tally: 0 } },
    { upsert: true }
  );
  await rooms.insertOne({ passcode, hostId: chatId });
  return passcode;
};

const joinRoom = async (chatId, name, username, passcode) => {
  const users = db.collection("users");
  const rooms = db.collection("rooms");
  const room = await rooms.findOne({ passcode });
  if (!room) {
    return { error: "No such room" };
  }

  const count = await users.countDocuments({ passcode });
  if (count >= 4) {
    return { error: "Room full" };
  }

  const user = await users.findOne({ chatId, passcode });
  if (user != null) {
    return { error: "Player exists" };
  }

  await users.updateOne(
    { chatId },
    { $set: { name, username, passcode, tally: 0 } },
    { upsert: true }
  );
  return { hostId: room.hostId };
};

const getRoomPlayers = async (chatId) => {
  const users = db.collection("users");
  const user = await users.findOne({ chatId });
  const passcode = user.passcode;
  const players = await users.find({ passcode }).toArray();
  return players;
};

const tenTwenty = {
  oneTai: {
    shooter: 0.1,
    zimo: 0.2,
  },
  twoTai: {
    shooter: 0.2,
    zimo: 0.4,
  },
  threeTai: {
    shooter: 0.4,
    zimo: 0.8,
  },
  fourTai: {
    shooter: 0.8,
    zimo: 1.6,
  },
  fiveTai: {
    shooter: 1.6,
    zimo: 3.2,
  },
  kong: {
    shooter: 0.1,
    zimo: 0.2,
  },
};
const bets = tenTwenty;

const updateTally = async (type, shooterId, winnerId) => {
  const users = db.collection("users");
  const players = await getRoomPlayers(winnerId);

  // Resets tally for testing purposes
  for (const player of players) {
    await users.updateOne({ chatId: player.chatId }, { $set: { tally: 0 } });
  }

  switch (type) {
    case "1 Tai":
      updateShooterTally(
        shooterId,
        winnerId,
        bets.twoTai.shooter * 2 + bets.oneTai.zimo,
        0,
        bets.oneTai.shooter * 2 + bets.oneTai.zimo
      );
      break;
    case "2 Tai":
      updateShooterTally(
        shooterId,
        winnerId,
        bets.twoTai.shooter * 2 + bets.twoTai.zimo,
        0,
        bets.twoTai.shooter * 2 + bets.twoTai.zimo
      );
      break;
    case "3 Tai":
      updateShooterTally(
        shooterId,
        winnerId,
        bets.threeTai.shooter * 2 + bets.threeTai.zimo,
        0,
        bets.threeTai.shooter * 2 + bets.threeTai.zimo
      );
      break;
    case "4 Tai":
      updateShooterTally(
        shooterId,
        winnerId,
        bets.fourTai.shooter * 2 + bets.fourTai.zimo,
        0,
        bets.fourTai.shooter * 2 + bets.fourTai.zimo
      );
      break;
    case "5 Tai":
      updateShooterTally(
        shooterId,
        winnerId,
        bets.fiveTai.shooter * 2 + bets.fiveTai.zimo,
        0,
        bets.fiveTai.shooter * 2 + bets.fiveTai.zimo
      );
      break;
    case "Zimo 1 Tai":
      updateZimoTally(winnerId, bets.oneTai.zimo, bets.oneTai.zimo * 3);
      break;
    case "Zimo 2 Tai":
      updateZimoTally(winnerId, bets.twoTai.zimo, bets.twoTai.zimo * 3);
      break;
    case "Zimo 3 Tai":
      updateZimoTally(winnerId, bets.threeTai.zimo, bets.threeTai.zimo * 3);
      break;
    case "Zimo 4 Tai":
      updateZimoTally(winnerId, bets.fourTai.zimo, bets.fourTai.zimo * 3);
      break;
    case "Zimo 5 Tai":
      updateZimoTally(winnerId, bets.fiveTai.zimo, bets.fiveTai.zimo * 3);
      break;
    case "Bite":
      updateZimoTally(winnerId, bets.kong.shooter, bets.kong.shooter * 3);
      break;
    case "Double Bite":
      updateZimoTally(winnerId, bets.kong.zimo, bets.kong.zimo * 3);
      break;
    case "Kong":
      updateShooterTally(
        shooterId,
        winnerId,
        bets.kong.shooter * 3,
        0,
        bets.kong.shooter * 3
      );
    case "Zimo Kong":
      updateZimoTally(winnerId, bets.kong.zimo, bets.kong.zimo * 3);
      break;
  }
};

const updateShooterTally = async (
  shooterId,
  winnerId,
  shooterLoss,
  othersLoss,
  winnerWins
) => {
  const users = db.collection("users");
  const players = await getRoomPlayers(winnerId);

  for (const player of players) {
    if (player.chatId === parseInt(shooterId)) {
      await users.updateOne(
        { chatId: player.chatId },
        { $inc: { tally: -shooterLoss } }
      );
    } else if (player.chatId === winnerId) {
      await users.updateOne(
        { chatId: player.chatId },
        { $inc: { tally: winnerWins } }
      );
    } else {
      await users.updateOne(
        { chatId: player.chatId },
        { $inc: { tally: othersLoss } }
      );
    }
  }
};

const updateZimoTally = async (winnerId, othersLoss, winnerWins) => {
  const users = db.collection("users");
  const players = await getRoomPlayers(winnerId);

  for (const player of players) {
    if (player.chatId !== parseInt(winnerId)) {
      await users.updateOne(
        { chatId: player.chatId },
        { $inc: { tally: -othersLoss } }
      );
    } else {
      await users.updateOne(
        { chatId: player.chatId },
        { $inc: { tally: winnerWins } }
      );
    }
  }
};

const updateMenu = async (chatId, currentMenu) => {
  const users = db.collection("users");
  const user = await users.findOne({ chatId });

  let menus = user.menus;
  if (!menus || currentMenu === "Start") {
    menus = [currentMenu];
  } else if (menus.includes(currentMenu)) {
    if (menus[menus.length - 1] === currentMenu) {
      // Refreshed menu
      return;
    } else {
      const index = menus.findIndex((e) => e === currentMenu);
      menus = menus.slice(0, index + 1);
    }
  } else {
    menus.push(currentMenu);
  }

  await users.updateOne(
    { chatId },
    {
      $set: { menus },
    },
    { upsert: true }
  );
};

const previousMenu = async (chatId, skips) => {
  const users = db.collection("users");
  const user = await users.findOne({ chatId });

  if (!user) {
    return null;
  } else if (user.menus.length < 2) {
    return null;
  } else {
    return user.menus[user.menus.length - skips - 1];
  }
};

module.exports = {
  registerUser: wrapper(registerUser),
  createRoom: wrapper(createRoom),
  joinRoom: wrapper(joinRoom),
  getRoomPlayers: wrapper(getRoomPlayers),
  updateTally: wrapper(updateTally),
  updateMenu: wrapper(updateMenu),
  previousMenu: wrapper(previousMenu),
};
