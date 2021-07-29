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
  const users = db.collection("users");
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

  const rooms = db.collection("rooms");
  const users = db.collection("users");
  const players = {};
  players[chatId] = { name, username, tally: 0 };

  await rooms.insertOne({ passcode, hostId: chatId, players });
  await users.updateOne({ chatId }, { $set: { passcode } });
  return passcode;
};

const joinRoom = async (chatId, name, username, passcode) => {
  const rooms = db.collection("rooms");
  const users = db.collection("users");
  const room = await rooms.findOne({ passcode });
  if (!room) {
    return { error: "No such room" };
  }

  const players = room.players;
  if (Object.keys(players).length >= 4) {
    return { error: "Room full" };
  }

  if (players[chatId] != undefined) {
    return { error: "Player exists" };
  }

  players[chatId] = { name, username, tally: 0 };
  await rooms.updateOne({ passcode }, { $set: { players } });
  await users.updateOne({ chatId }, { $set: { passcode } });
  return { hostId: room.hostId };
};

const getRoomPlayers = async (hostId) => {
  const rooms = db.collection("rooms");
  const room = await rooms.findOne({ hostId });
  return Object.keys(room.players).map((id) => parseInt(id));
};

const getTally = async (chatId) => {
  const rooms = db.collection("rooms");
  const users = db.collection("users");

  const user = await users.findOne({ chatId });
  const passcode = user.passcode;
  const room = await rooms.findOne({ passcode });
  const players = room.players;
  const totalTally = [];

  Object.keys(players).forEach((playerId) =>
    totalTally.push(players[playerId])
  );
  return totalTally;
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
  getTally: wrapper(getTally),
  updateMenu: wrapper(updateMenu),
  previousMenu: wrapper(previousMenu),
};
