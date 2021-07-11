const express = require("express");
const axios = require("axios").default;
const PORT = 5000;
const app = express();
const server = app.listen(PORT, () => {
  console.log(`Listening on port ${PORT}`);
  console.log(`http://localhost:${PORT}`);
});
const io = require("socket.io")(server, {
  cors: {
    origin: "http://127.0.0.1:5500",
    methods: ["GET", "POST"],
  },
});

let board;
let solvedBoard;
let clients = [];
let difficultyVotes = [];
let boardTimeSec = 0;
let updateTime = false;
let nextGameSec = 10;
let decreaseNewGameSec = false;
let winState = false;
async function findBoard(difficulty) {
  const url = `http://www.cs.utep.edu/cheon/ws/sudoku/new/?size=9&level=${difficulty}`; // 9x9 with 2 difficulty
  const response = await axios.get(url);
  const data = await response.data;
  return data;
}

const convertFetchedBoardIntoBoard = (board) => {
  let newBoard = new Array(9);
  for (let i = 0; i < 9; i++) {
    newBoard[i] = new Array(9);
  }

  for (const square of board.squares) {
    const { x, y, value } = square;
    newBoard[y][x] = { x: x, y: y, value: value, notes: [], predefined: true };
  }

  for (let y = 0; y < 9; y++) {
    for (let x = 0; x < 9; x++) {
      if (!newBoard[y][x]) {
        newBoard[y][x] = {
          x: x,
          y: y,
          value: null,
          notes: [],
          predefined: false,
        };
      }
    }
  }

  return newBoard;
};

const updater = setInterval(async () => {
  updateTime ? boardTimeSec++ : null;
  if (decreaseNewGameSec) {
    nextGameSec--;
    broadcastToAll("next_game_time", nextGameSec, null);
  }

  if (nextGameSec === 0) {
    broadcastToAll("next_game_starting", "", null);
    const newDifficulty = getMostVoted();

    board = await findBoard(newDifficulty);
    board = convertFetchedBoardIntoBoard(board);
    broadcastToAll("new_board_received", board, null);
    decreaseNewGameSec = false;
    updateTime = true;
    boardTimeSec = 0;
    nextGameSec = 10;
    difficultyVotes.length = 0;
    winState = false;
  }
}, 1000);
const init = async () => {
  // find board

  const fetchedBoard = await findBoard(2);
  board = convertFetchedBoardIntoBoard(fetchedBoard);
};

init();

const broadcastToAll = (event, message, source) => {
  for (const client of clients) {
    client.emit(event, message);
  }
};

const getMostVoted = () => {
  if (difficultyVotes.length === 0) {
    return 2;
  }
  let counts = {};

  for (const vote of difficultyVotes) {
    if (!counts[vote]) {
      counts[vote] = 1;
    } else {
      counts[vote]++;
    }
  }

  return parseInt(
    Object.keys(counts).reduce((a, b) => (counts[a] > counts[b] ? a : b))
  );
};

const checkWin = () => {
  let ok = true;

  // rows
  for (let y = 0; y < 9; y++) {
    let sum = 0;
    for (let x = 0; x < 9; x++) {
      sum += board[y][x].value ? board[y][x].value : 0;
    }
  }

  // cols
  for (let x = 0; x < 9; x++) {
    let sum = 0;
    for (let y = 0; y < 9; y++) {
      sum += board[y][x].value ? board[y][x].value : 0;
    }

    if (sum !== 45) ok = false;
  }

  // boxes

  for (let x = 0; x < 9; x += 3) {
    for (let y = 0; y < 9; y += 3) {
      if (
        board[y][x].value +
          board[y][x + 1].value +
          board[y][x + 2].value +
          board[y + 1][x].value +
          board[y + 1][x + 1].value +
          board[y + 1][x + 2].value +
          board[y + 2][x].value +
          board[y + 2][x + 1].value +
          board[y + 2][x + 2].value !==
        45
      ) {
        ok = false;
      }
    }
  }

  return ok;
};

io.on("connection", (socket) => {
  clients.push(socket);
  if (clients.length === 1) {
    updateTime = true;
  }

  if (board) {
    if (winState) {
      let timeString = `${Math.floor(boardTimeSec / 60)} : ${
        boardTimeSec % 60
      }`;
      let minute = Math.floor(boardTimeSec / 60);
      let second = boardTimeSec % 60;
      timeString = `${minute < 10 ? "0" + minute.toString() : minute} : ${
        second < 10 ? "0" + second.toString() : second
      }`;
      socket.emit(
        "joined_on_game_won",
        JSON.stringify({
          timeString: timeString,
          voteStandings: getMostVoted(),
        })
      );
    } else {
      socket.emit("board_received", board);
    }
  }
  broadcastToAll("client_count_changed", clients.length - 1, null);
  // received number from client
  socket.on("number_placed", (arg) => {
    const { x, y, value } = JSON.parse(arg);

    board[y][x].value = parseInt(value);
    if (checkWin()) {
      updateTime = false;
      winState = true;
      let timeString = `${Math.floor(boardTimeSec / 60)} : ${
        boardTimeSec % 60
      }`;
      let minute = Math.floor(boardTimeSec / 60);
      let second = boardTimeSec % 60;
      timeString = `${minute < 10 ? "0" + minute.toString() : minute} : ${
        second < 10 ? "0" + second.toString() : second
      }`;
      broadcastToAll(
        "game_won",
        JSON.stringify({ timeString: timeString }),
        socket
      );
      decreaseNewGameSec = true;
    }
    board[y][x].notes.length = 0;

    broadcastToAll("number_received", arg, socket);
  });

  socket.on("note_placed", (arg) => {
    const { x, y, noteValue } = JSON.parse(arg);
    board[y][x].notes.push(noteValue);
    broadcastToAll("note_received", arg, socket);
  });

  socket.on("difficulty_voted", (arg) => {
    const value = arg;

    difficultyVotes.push(parseInt(value));

    broadcastToAll("current_vote_result", getMostVoted(), socket);
  });

  socket.on("disconnect", (arg) => {
    console.log("disconnected");
    clients = clients.filter((client) => client !== socket);
    broadcastToAll("client_count_changed", clients.length - 1, null);

    if (clients.length === 0) {
      // pause game if no one is connected
      updateTime = false;
    }
  });
});
