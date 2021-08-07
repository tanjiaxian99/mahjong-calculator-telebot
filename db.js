const mongoose = require("mongoose");
const fetch = require("node-fetch");
const winningSystems = require("./winningSystems");
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
  await rooms.insertOne({
    passcode,
    hostId: chatId,
    isShooter: true,
    winningSystem: winningSystems.twentyFourty,
  });
  return passcode;
};

const updateMessageIdHistory = async (chatId, messageId) => {
  const users = db.collection("users");
  await users.updateOne({ chatId }, { $push: { messageIdHistory: messageId } });
};

const deleteMessageIdHistory = async (chatId) => {
  const users = db.collection("users");
  const user = await users.findOne({ chatId });
  if (user === null) {
    return undefined;
  }

  await users.updateOne({ chatId }, { $unset: { messageIdHistory: "" } });
  return user.messageIdHistory;
};

const joinRoom = async (chatId, name, username, passcode) => {
  const users = db.collection("users");
  const rooms = db.collection("rooms");

  let user = await users.findOne({ chatId });
  if (user === null) {
    return { error: "Unregistered user" };
  }

  const room = await rooms.findOne({ passcode });
  if (!room) {
    return { error: "No such room" };
  }

  const count = await users.countDocuments({ passcode });
  if (count >= 4) {
    return { error: "Room full" };
  }

  user = await users.findOne({ chatId, passcode });
  if (user !== null) {
    return { error: "Player exists" };
  }

  await users.updateOne(
    { chatId },
    { $set: { name, username, passcode, tally: 0 } }
  );
  return { hostId: room.hostId };
};

const leaveRoom = async (chatId) => {
  const users = db.collection("users");
  const rooms = db.collection("rooms");
  await users.updateOne({ chatId }, { $unset: { passcode: "" } });
  await rooms.deleteOne({ hostId: chatId });
};

const getHostId = async (chatId) => {
  const users = db.collection("users");
  const user = await users.findOne({ chatId });
  const passcode = user.passcode;
  const rooms = db.collection("rooms");
  const room = await rooms.findOne({ passcode });
  return room.hostId;
};

const getRoomPlayers = async (chatId) => {
  const users = db.collection("users");
  const user = await users.findOne({ chatId });
  const passcode = user.passcode;
  const players = await users.find({ passcode }).toArray();
  return players;
};

const updateTally = async (type, shooterId, winnerId) => {
  const users = db.collection("users");
  const players = await getRoomPlayers(winnerId);
  const isShooter = await getIsShooter(winnerId);
  const winningSystem = await getWinningSystem(winnerId);

  // Resets tally for testing purposes
  for (const player of players) {
    await users.updateOne({ chatId: player.chatId }, { $set: { tally: 0 } });
  }

  switch (type) {
    case "1 Tai":
      isShooter
        ? updateShooterTally(
            shooterId,
            winnerId,
            winningSystem.oneTai.base * 2 + winningSystem.oneTai.zimo,
            0,
            winningSystem.oneTai.base * 2 + winningSystem.oneTai.zimo
          )
        : updateShooterTally(
            shooterId,
            winnerId,
            winningSystem.oneTai.zimo,
            winningSystem.oneTai.base,
            winningSystem.oneTai.base * 2 + winningSystem.oneTai.zimo
          );
      break;
    case "2 Tai":
      isShooter
        ? updateShooterTally(
            shooterId,
            winnerId,
            winningSystem.twoTai.base * 2 + winningSystem.twoTai.zimo,
            0,
            winningSystem.twoTai.base * 2 + winningSystem.twoTai.zimo
          )
        : updateShooterTally(
            shooterId,
            winnerId,
            winningSystem.twoTai.zimo,
            winningSystem.twoTai.base,
            winningSystem.twoTai.base * 2 + winningSystem.twoTai.zimo
          );
      break;
    case "3 Tai":
      isShooter
        ? updateShooterTally(
            shooterId,
            winnerId,
            winningSystem.threeTai.base * 2 + winningSystem.threeTai.zimo,
            0,
            winningSystem.threeTai.base * 2 + winningSystem.threeTai.zimo
          )
        : updateShooterTally(
            shooterId,
            winnerId,
            winningSystem.threeTai.zimo,
            winningSystem.threeTai.base,
            winningSystem.threeTai.base * 2 + winningSystem.threeTai.zimo
          );
      break;
    case "4 Tai":
      isShooter
        ? updateShooterTally(
            shooterId,
            winnerId,
            winningSystem.fourTai.base * 2 + winningSystem.fourTai.zimo,
            0,
            winningSystem.fourTai.base * 2 + winningSystem.fourTai.zimo
          )
        : updateShooterTally(
            shooterId,
            winnerId,
            winningSystem.fourTai.zimo,
            winningSystem.fourTai.base,
            winningSystem.fourTai.base * 2 + winningSystem.fourTai.zimo
          );
      break;
    case "5 Tai":
      isShooter
        ? updateShooterTally(
            shooterId,
            winnerId,
            winningSystem.fiveTai.base * 2 + winningSystem.fiveTai.zimo,
            0,
            winningSystem.fiveTai.base * 2 + winningSystem.fiveTai.zimo
          )
        : updateShooterTally(
            shooterId,
            winnerId,
            winningSystem.fiveTai.zimo,
            winningSystem.fiveTai.base,
            winningSystem.fiveTai.base * 2 + winningSystem.fiveTai.zimo
          );
      break;
    case "Zimo 1 Tai":
      updateZimoTally(
        winnerId,
        winningSystem.oneTai.zimo,
        winningSystem.oneTai.zimo * 3
      );
      break;
    case "Zimo 2 Tai":
      updateZimoTally(
        winnerId,
        winningSystem.twoTai.zimo,
        winningSystem.twoTai.zimo * 3
      );
      break;
    case "Zimo 3 Tai":
      updateZimoTally(
        winnerId,
        winningSystem.threeTai.zimo,
        winningSystem.threeTai.zimo * 3
      );
      break;
    case "Zimo 4 Tai":
      updateZimoTally(
        winnerId,
        winningSystem.fourTai.zimo,
        winningSystem.fourTai.zimo * 3
      );
      break;
    case "Zimo 5 Tai":
      updateZimoTally(
        winnerId,
        winningSystem.fiveTai.zimo,
        winningSystem.fiveTai.zimo * 3
      );
      break;
    case "Bite":
      updateZimoTally(
        winnerId,
        winningSystem.oneTai.base,
        winningSystem.oneTai.base * 3
      );
      break;
    case "Double Bite":
      updateZimoTally(
        winnerId,
        winningSystem.oneTai.zimo,
        winningSystem.oneTai.zimo * 3
      );
      break;
    case "Kong":
      isShooter
        ? updateShooterTally(
            shooterId,
            winnerId,
            winningSystem.oneTai.base * 3,
            0,
            winningSystem.oneTai.base * 3
          )
        : updateShooterTally(
            shooterId,
            winnerId,
            winningSystem.oneTai.base,
            winningSystem.oneTai.base,
            winningSystem.oneTai.base * 3
          );
    case "Zimo Kong":
      updateZimoTally(
        winnerId,
        winningSystem.oneTai.zimo,
        winningSystem.oneTai.zimo * 3
      );
      break;
    case "Matching Flowers":
      updateShooterTally(
        shooterId,
        winnerId,
        winningSystem.oneTai.base,
        0,
        winningSystem.oneTai.base
      );
    case "Hidden Matching Flowers":
      updateShooterTally(
        shooterId,
        winnerId,
        winningSystem.oneTai.zimo,
        0,
        winningSystem.oneTai.zimo
      );
  }
};

const getIsShooter = async (chatId) => {
  const users = db.collection("users");
  const rooms = db.collection("rooms");
  const user = await users.findOne({ chatId });
  const passcode = user.passcode;
  const room = await rooms.findOne({ passcode });
  return room.isShooter;
};

const updateIsShooter = async (hostId, isShooter) => {
  const rooms = db.collection("rooms");
  await rooms.updateOne({ hostId }, { $set: { isShooter } });
};

const getWinningSystem = async (chatId) => {
  const users = db.collection("users");
  const rooms = db.collection("rooms");
  const user = await users.findOne({ chatId });
  const passcode = user.passcode;
  const room = await rooms.findOne({ passcode });
  return room.winningSystem;
};

const setWinningSystem = async (hostId, selectedSystem) => {
  const rooms = db.collection("rooms");
  if (typeof selectedSystem === "string") {
    await rooms.updateOne(
      { hostId },
      { $set: { winningSystem: winningSystems[selectedSystem] } }
    );
  } else {
    await rooms.updateOne(
      { hostId },
      { $set: { winningSystem: selectedSystem } }
    );
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
        { $inc: { tally: -othersLoss } }
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
  updateMessageIdHistory: wrapper(updateMessageIdHistory),
  deleteMessageIdHistory: wrapper(deleteMessageIdHistory),
  joinRoom: wrapper(joinRoom),
  leaveRoom: wrapper(leaveRoom),
  getHostId: wrapper(getHostId),
  getRoomPlayers: wrapper(getRoomPlayers),
  updateTally: wrapper(updateTally),
  updateIsShooter: wrapper(updateIsShooter),
  getWinningSystem: wrapper(getWinningSystem),
  setWinningSystem: wrapper(setWinningSystem),
  updateMenu: wrapper(updateMenu),
  previousMenu: wrapper(previousMenu),
};
