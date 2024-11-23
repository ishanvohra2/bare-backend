const express = require("express");
const app = express();
const dotEnv = require("dotenv");
const bodyParser = require("body-parser");
const cors = require("cors");
const url = require("url");
const Hyperswarm = require("hyperswarm");
const goodbye = require("graceful-goodbye");
const crypto = require("hypercore-crypto");
const b4a = require("b4a");
const fs = require("fs");
dotEnv.config();

app.use(cors());
app.use(bodyParser.urlencoded({ extended: false }));

let chat = "hi! how are you?";
const connectPeers = (peerId) => {
  const swarm = new Hyperswarm();
  goodbye(() => swarm.destroy());

  // Keep track of all connections and console.log incoming data
  const conns = [];
  swarm.on("connection", (conn) => {
    const name = b4a.toString(conn.remotePublicKey, "hex");
    console.log("* got a connection from:", name, "*");
    conns.push(conn);
    conn.once("close", () => conns.splice(conns.indexOf(conn), 1));
    conn.on("data", (data) => {
      console.log(`${name}: ${data}`);
      let msg = `${data}`;
      let obj = { name, msg };
      chat = msg;
      fs.writeFileSync("message.txt",JSON.stringify(obj), (err) => {
        if (err) console.log(err);
      })
    });
  });

  // Broadcast stdin to all connections
  process.stdin.on("data", (d) => {
    for (const conn of conns) {
      conn.write(d);
    }
  });

  // Join a common topic
  if (peerId) process.argv[2] = peerId

  const topic = process.argv[2]
    ? b4a.from(process.argv[2], "hex")
    : crypto.randomBytes(32);
  const discovery = swarm.join(topic, { client: true, server: true });

  // The flushed promise will resolve when the topic has been fully announced to the DHT
  discovery.flushed().then(() => {
    console.log("joined topic:", b4a.toString(topic, "hex"));
    fs.writeFileSync("peerId.txt", b4a.toString(topic, "hex"), (err) => {
      if (err) console.log(err);
    });
  });
};

app.get("/", (req, res) => {
  res.json({ message: "All operational !" });
});

app.get("/api/get-peer-id", async (req, res) => {
  await connectPeers();
  const topic = crypto.randomBytes(32);
  let peerId = b4a.toString(topic, "hex");
  res.json({id: peerId});
});

app.get("/api/connect-peers", async (req, res) => {
  let {peerId, msg} = req.query;
  peerId = fs.readFileSync("peerId.txt").toString();
  await connectPeers(peerId,msg);
  console.log(chat);
  res.json({ msg: chat });
});

app.listen(process.env.SERVER_PORT, () => {
  console.log(`Server running on port ${process.env.SERVER_PORT}`);
});
