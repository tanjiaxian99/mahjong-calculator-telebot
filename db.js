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
  const rooms = db.collection("rooms");
  const players = await getRoomPlayers(winnerId);

  switch (type) {
    case "1 Tai":
    case "2 Tai":
    case "3 Tai":
    case "4 Tai":
    case "5 Tai":
      break;
    case "Zimo 1 Tai":
    case "Zimo 2 Tai":
    case "Zimo 3 Tai":
    case "Zimo 4 Tai":
    case "Zimo 5 Tai":
      break;
    case "Bite":
      for (const player of players) {
        if (player.chatId !== parseInt(winnerId)) {
          await users.updateOne(
            { chatId: player.chatId },
            { $inc: { tally: -bets.kong.shooter } }
          );
        } else {
          await users.updateOne(
            { chatId: player.chatId },
            { $inc: { tally: bets.kong.shooter * 3 } }
          );
        }
      }
      break;
    case "Double Bite":
    case "Zimo Kong":
      for (const player of players) {
        if (player.chatId !== parseInt(winnerId)) {
          await users.updateOne(
            { chatId: player.chatId },
            { $inc: { tally: -bets.kong.zimo } }
          );
        } else {
          await users.updateOne(
            { chatId: player.chatId },
            { $inc: { tally: bets.kong.zimo * 3 } }
          );
        }
      }
      break;
    case "Kong":
      for (const player of players) {
        if (player.chatId === parseInt(shooterId)) {
          await users.updateOne(
            { chatId: player.chatId },
            { $inc: { tally: -bets.kong.shooter * 3 } }
          );
        } else if (player.chatId === winnerId) {
          await users.updateOne(
            { chatId: player.chatId },
            { $inc: { tally: bets.kong.shooter * 3 } }
          );
        }
      }
      break;
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
