async function findBoard(difficulty) {
  const url = `http://www.cs.utep.edu/cheon/ws/sudoku/new/?size=9&level=2`; // 9x9 with 2 difficulty
  const response = await axios.get(url);
  const data = await response.data;
  return data;
}

module.exports.findBoard = findBoard;
