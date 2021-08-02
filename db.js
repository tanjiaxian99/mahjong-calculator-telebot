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

// const getTally = async (chatId) => {
//   const players = await getRoomPlayers(chatId);
//   players.forEach(player => ({}))
//   Object.keys(players).forEach((playerId) =>
//     totalTally.push(players[playerId])
//   );
//   return totalTally;
// };

const tenTwenty = {
  oneTai: 0.1,
  twoTai: 0.2,
  threeTai: 0.4,
  fourTai: 0.8,
  fiveTai: 1.6,
  kong: 0.1,
  hiddenKong: 0.2,
};
const threeSixHalf = [2, 3, 5, 10, 20, 1, 1];
const threeSix = [4, 7, 11, 20, 40, 3, 2];
const bets = tenTwenty;

const updateTally = async (type, shooterId, winnerId) => {
  const users = db.collection("users");
  const rooms = db.collection("rooms");
  const players = await getRoomPlayers(winnerId);

  if (type == "Kong") {
    for (const player of players) {
      if (player.chatId === parseInt(shooterId)) {
        await users.updateOne(
          { chatId: player.chatId },
          { $inc: { tally: -bets.kong * 3 } }
        );
      } else if (player.chatId === winnerId) {
        await users.updateOne(
          { chatId: player.chatId },
          { $inc: { tally: bets.kong * 3 } }
        );
      }
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
