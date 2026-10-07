/* =====================================================
   HIGHER OR LOWER: ANIME POPULARITY EDITION
   Plain JavaScript, written step by step with functions.
   Flow: Setup -> Handoff -> Gameplay -> (next player) -> Scoreboard
   ===================================================== */

/* ---------- 1. SETTINGS (constants never change) ---------- */
const ANILIST_URL = "https://graphql.anilist.co";
// The exact GraphQL query: top 100 most popular anime
const GRAPHQL_QUERY =
  "query { Page(page: 1, perPage: 100) { media(type: ANIME, sort: POPULARITY_DESC) { id title { romaji english } popularity coverImage { extraLarge } } } }";
const STORAGE_KEY = "animeHigherLowerPlayers"; // localStorage key for saved names
const MAX_PLAYERS = 5;
const TURN_SECONDS = 10; // time allowed per guess
const TICK_MS = 50;      // how often the timer bar updates
const SLIDE_MS = 700;    // must match --t-slide in style.css (0.7s)
const FIRE_STREAK = 5;   // streak needed for the fire effect
const SCREEN_IDS = ["setup-screen", "handoff-screen", "game-screen", "scoreboard-screen"];
// Small labels above each title (A shows its number, B is the mystery one)
const EYEBROW_A = "Anime A  ·  Known popularity";
const EYEBROW_B = "Anime B  ·  Make your call";

/* ---------- 2. GAME STATE (variables that change while playing) ---------- */
let allAnime = [];          // the 100 anime fetched from AniList
let usedIds = new Set();    // ids already shown this session (no repeats)
let players = [];           // [{ name: "Marc", score: 0 }, ...]
let currentPlayerIndex = 0; // whose turn it is
let currentScore = 0;       // current player's correct guesses
let currentStreak = 0;      // correct guesses in a row
let animeA = null;          // left/top anime (number visible)
let animeB = null;          // right/bottom anime (number hidden)
let animeC = null;          // the next anime, waiting behind B
let isLocked = false;       // true while a guess is being processed
let timerInterval = null;   // handle for the running timer
let timeLeftMs = 0;         // time left on the clock

/* ---------- 3. GRAB PAGE ELEMENTS ONCE ---------- */
const errorBanner = document.getElementById("error-banner");
const playerCountInput = document.getElementById("player-count");
const nameFieldsBox = document.getElementById("name-fields");
const clearNamesBtn = document.getElementById("clear-names-btn");
const startBtn = document.getElementById("start-btn");
const startLabel = document.getElementById("start-label");
const loadStatus = document.getElementById("load-status");
const apiPill = document.getElementById("api-pill");
const apiPillText = document.getElementById("api-pill-text");
const siteHeader = document.getElementById("site-header");
const setupMessage = document.getElementById("setup-message");
const handoffText = document.getElementById("handoff-text");
const handoffCount = document.getElementById("handoff-count");
const startTurnBtn = document.getElementById("start-turn-btn");
const timerBar = document.getElementById("timer-bar");
const hudName = document.getElementById("hud-name");
const hudScore = document.getElementById("hud-score");
const hudStreak = document.getElementById("hud-streak");
const hudTimer = document.getElementById("hud-timer");
const hudTimerTile = document.getElementById("hud-timer-tile");
const panelB = document.getElementById("panel-b");
const panelC = document.getElementById("panel-c");
const vsBadge = document.getElementById("vs-badge");
const higherBtn = document.getElementById("higher-btn");
const lowerBtn = document.getElementById("lower-btn");
const flashOverlay = document.getElementById("flash-overlay");
const statusB = document.getElementById("status-b");
const winnerLine = document.getElementById("winner-line");
const board = document.getElementById("board");
const hudStreakTile = document.getElementById("hud-streak-tile");
const plusOne = document.getElementById("plus-one");
const confettiLayer = document.getElementById("confetti-layer");
const minusBtn = document.getElementById("minus-btn");
const plusBtn = document.getElementById("plus-btn");
const scoreList = document.getElementById("score-list");
const playAgainBtn = document.getElementById("play-again-btn");

/* =====================================================
   4. SCREEN SWITCHING
   ===================================================== */

// Shows one screen and hides the other three by toggling the .hidden class
function showScreen(screenId) {
  // The top bar is hidden while playing so the game fills the whole screen
  siteHeader.classList.toggle("hidden", screenId === "game-screen");
  for (let i = 0; i < SCREEN_IDS.length; i++) {
    const screen = document.getElementById(SCREEN_IDS[i]);
    if (SCREEN_IDS[i] === screenId) {
      screen.classList.remove("hidden");
    } else {
      screen.classList.add("hidden");
    }
  }
}

/* =====================================================
   5. API: FETCH ONCE
   ===================================================== */

// Updates the little status pill in the top bar ("loading", "live" or "error")
function setApiState(state, label) {
  apiPill.setAttribute("data-state", state);
  apiPillText.textContent = label;
}

// Runs silently when the page loads. "async/await" lets us wait for the
// network without freezing the page.
async function loadAnimeData() {
  try {
    const response = await fetch(ANILIST_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ query: GRAPHQL_QUERY })
    });

    // fetch only throws on network failure, so we also check the HTTP status
    if (!response.ok) {
      throw new Error("Server answered with status " + response.status);
    }

    const result = await response.json();
    const list = result.data.Page.media;

    // Keep only anime that have a cover image and a popularity number
    allAnime = list.filter(function (anime) {
      return anime.coverImage && anime.coverImage.extraLarge && typeof anime.popularity === "number";
    });

    if (allAnime.length < 3) {
      throw new Error("Not enough anime returned");
    }

    // Data is ready: unlock the Start button and show the green "live" pill
    startBtn.disabled = false;
    startLabel.textContent = "Start the game";
    loadStatus.textContent = allAnime.length + " anime loaded. Choose your players to begin.";
    loadStatus.classList.remove("is-loading");
    setApiState("live", "AniList live");
  } catch (error) {
    // Anything that went wrong lands here: show the red banner
    console.error("Could not load anime:", error);
    errorBanner.classList.remove("hidden");
    startLabel.textContent = "Start the game";
    loadStatus.textContent = "";
    setApiState("error", "Offline");
  }
}

/* =====================================================
   6. PHASE 1: SETUP SCREEN
   ===================================================== */

// Reads saved player names from localStorage (returns [] if none or broken)
function loadSavedNames() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) { return []; }
    const names = JSON.parse(raw);
    if (Array.isArray(names)) { return names.slice(0, MAX_PLAYERS); }
  } catch (error) {
    console.error("Could not read saved names:", error);
  }
  return [];
}

// Saves the player names so they auto-fill next time
function saveNames(names) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(names));
  } catch (error) {
    console.error("Could not save names:", error);
  }
}

// Builds one row (number badge + text input) for a player's name
function createNameInput(index, value) {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "name-input";
  input.placeholder = "Player " + (index + 1) + " name";
  input.maxLength = 16;
  input.autocomplete = "off";
  input.value = value || "";
  input.setAttribute("aria-label", "Player " + (index + 1) + " name");
  // Remove the red error border as soon as the person types again
  input.addEventListener("input", function () {
    input.classList.remove("input-error");
  });

  // Wrap the input in a row with a small number badge ("01", "02", ...)
  const row = document.createElement("div");
  row.className = "name-row";
  const badge = document.createElement("span");
  badge.className = "name-num";
  badge.textContent = String(index + 1).padStart(2, "0");
  row.appendChild(badge);
  row.appendChild(input);
  return row;
}

// Makes the number of name inputs match "count".
// It only adds or removes inputs at the end, so names already typed are kept.
function renderNameFields(count, savedNames) {
  let currentCount = nameFieldsBox.children.length;

  while (currentCount < count) {
    const savedValue = savedNames ? savedNames[currentCount] : "";
    nameFieldsBox.appendChild(createNameInput(currentCount, savedValue));
    currentCount++;
  }
  while (currentCount > count) {
    nameFieldsBox.removeChild(nameFieldsBox.lastElementChild);
    currentCount--;
  }
}

// Runs every time the "How many players?" number changes
function handlePlayerCountInput() {
  let count = parseInt(playerCountInput.value, 10);
  if (isNaN(count)) { return; } // box is empty while typing: do nothing yet
  if (count > MAX_PLAYERS) { count = MAX_PLAYERS; }
  if (count < 1) { count = 1; }
  playerCountInput.value = count;
  renderNameFields(count, null);
}

// The big - and + buttons: nudge the number, then reuse the normal input logic
function changePlayerCount(change) {
  const current = parseInt(playerCountInput.value, 10) || nameFieldsBox.children.length;
  playerCountInput.value = current + change;
  handlePlayerCountInput(); // clamps to 1-5 and adds/removes name rows
}

// If the person leaves the number box empty, put back the real count
function handlePlayerCountBlur() {
  if (isNaN(parseInt(playerCountInput.value, 10))) {
    playerCountInput.value = nameFieldsBox.children.length;
  }
}

// "Clear Names": empties every input and deletes the saved memory
function handleClearNames() {
  const inputs = nameFieldsBox.querySelectorAll(".name-input");
  for (let i = 0; i < inputs.length; i++) {
    inputs[i].value = "";
    inputs[i].classList.remove("input-error");
  }
  localStorage.removeItem(STORAGE_KEY);
  setupMessage.textContent = "";
  if (inputs.length > 0) { inputs[0].focus(); }
}

// "Start Game": check every name is filled in, then go to the handoff screen
function handleStartClick() {
  const inputs = nameFieldsBox.querySelectorAll(".name-input");
  const names = [];
  let allFilled = true;

  for (let i = 0; i < inputs.length; i++) {
    const name = inputs[i].value.trim();
    if (name === "") {
      allFilled = false;
      inputs[i].classList.add("input-error");
    } else {
      names.push(name);
    }
  }

  if (!allFilled) {
    setupMessage.textContent = "Enter a name for every player to start.";
    return;
  }
  if (allAnime.length < 3) {
    setupMessage.textContent = "Anime data is not loaded. Please refresh the page.";
    return;
  }

  // Everything is valid: set up a brand new session
  setupMessage.textContent = "";
  saveNames(names);
  players = names.map(function (name) { return { name: name, score: 0, bestStreak: 0 }; });
  currentPlayerIndex = 0;
  usedIds.clear(); // new session = nothing has been shown yet
  showHandoff();
}

/* =====================================================
   7. PHASE 2: HANDOFF SCREEN
   ===================================================== */

// Tells everyone whose turn it is so the previous player can't peek
function showHandoff() {
  handoffCount.textContent = "Turn " + (currentPlayerIndex + 1) + " of " + players.length;
  handoffText.textContent = "Pass the phone to ";
  // The name goes in its own <span> so CSS can colour it
  const nameSpan = document.createElement("span");
  nameSpan.className = "accent";
  nameSpan.textContent = players[currentPlayerIndex].name;
  handoffText.appendChild(nameSpan);
  showScreen("handoff-screen");
}

/* =====================================================
   8. RANDOM ANIME PICKER
   ===================================================== */

// Loads an image early so it is cached before it appears on screen
function preloadImage(url) {
  const image = new Image();
  image.src = url;
}

// Picks a random anime that has not been used this session.
// "avoidIds" lists anime currently on screen that must not be picked again.
function pickRandomAnime(avoidIds) {
  let available = allAnime.filter(function (anime) {
    return !usedIds.has(anime.id) && !avoidIds.includes(anime.id);
  });

  // If all 100 were used (a very long game), start the pool over
  if (available.length === 0) {
    usedIds.clear();
    available = allAnime.filter(function (anime) {
      return !avoidIds.includes(anime.id);
    });
  }

  const randomIndex = Math.floor(Math.random() * available.length);
  const chosen = available[randomIndex];
  usedIds.add(chosen.id);
  preloadImage(chosen.coverImage.extraLarge);
  return chosen;
}

/* =====================================================
   9. DISPLAY HELPERS
   ===================================================== */

// English title if it exists, otherwise Romaji
function getTitle(anime) {
  return anime.title.english || anime.title.romaji;
}

// 1250000 becomes "1,250,000 users"
function formatPopularity(anime) {
  return anime.popularity.toLocaleString("en-US") + " users";
}

// Puts an anime's image, title and number into panel "a", "b" or "c"
function fillPanel(side, anime, showNumber) {
  document.getElementById("panel-" + side).style.backgroundImage = 'url("' + anime.coverImage.extraLarge + '")';
  document.getElementById("title-" + side).textContent = getTitle(anime);
  document.getElementById("pop-" + side).textContent = showNumber ? formatPopularity(anime) : "? ? ?";
  document.getElementById("eyebrow-" + side).textContent = side === "a" ? EYEBROW_A : EYEBROW_B;
  if (side === "b") {
    statusB.textContent = ""; // wipe the last result message
    statusB.className = "status";
  }
}

// Updates the name, score and streak tiles at the top of the game screen
function updateHud() {
  hudName.textContent = players[currentPlayerIndex].name;
  hudScore.textContent = currentScore;

  // The streak tile gets a flame at 3+ and burns hotter at 5+
  hudStreak.textContent = currentStreak >= 3 ? "🔥 " + currentStreak : currentStreak;
  let heat = "cold";
  if (currentStreak >= FIRE_STREAK) { heat = "hot"; }
  else if (currentStreak >= 3) { heat = "warm"; }
  hudStreakTile.setAttribute("data-heat", heat);
}

// Turns Higher/Lower buttons on or off (off after a guess)
function setGuessButtonsDisabled(isDisabled) {
  higherBtn.disabled = isDisabled;
  lowerBtn.disabled = isDisabled;
}

// Flashes the screen green or red and writes a status line under Anime B's title
function playFlash(isCorrect, message) {
  flashOverlay.classList.remove("play", "correct", "wrong");
  void flashOverlay.offsetWidth; // forces the browser to "forget" the old animation
  flashOverlay.classList.add("play", isCorrect ? "correct" : "wrong");
  statusB.textContent = message;
  statusB.className = isCorrect ? "status" : "status bad";
}

/* =====================================================
   9b. EFFECT HELPERS (animations, vibration, image loading)
   ===================================================== */

// True if the person asked their device for less motion
function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Short phone vibration on supported devices (does nothing on desktop)
function vibrate(pattern) {
  if (navigator.vibrate) { navigator.vibrate(pattern); }
}

// Re-plays a CSS animation by removing and re-adding its class
function restartClass(element, className) {
  element.classList.remove(className);
  void element.offsetWidth; // forces the browser to reset the animation
  element.classList.add(className);
}

// Counts a number up from 0 to "target" and then calls onDone().
// requestAnimationFrame runs once per screen refresh, so the motion is smooth.
function countUp(element, target, durationMs, onDone) {
  if (prefersReducedMotion()) {
    element.textContent = target.toLocaleString("en-US") + " users";
    onDone();
    return;
  }
  const startTime = performance.now();
  function step(now) {
    const progress = Math.min((now - startTime) / durationMs, 1);
    const eased = 1 - Math.pow(1 - progress, 3); // fast at first, slows down at the end
    element.textContent = Math.round(target * eased).toLocaleString("en-US") + " users";
    if (progress < 1) {
      requestAnimationFrame(step);
    } else {
      onDone();
    }
  }
  requestAnimationFrame(step);
}

// Waits until every image URL has loaded, but gives up after maxMs
// so a slow connection can never freeze the game.
function waitForImages(urls, maxMs) {
  const loaders = urls.map(function (url) {
    return new Promise(function (resolve) {
      const image = new Image();
      image.onload = resolve;
      image.onerror = resolve; // a broken image should not block the game
      image.src = url;
    });
  });
  const timeout = new Promise(function (resolve) { setTimeout(resolve, maxMs); });
  return Promise.race([Promise.all(loaders), timeout]);
}

// Drops colourful confetti pieces from the top of the scoreboard
function launchConfetti() {
  if (prefersReducedMotion()) { return; }
  const colors = ["#e2573b", "#cdf24a", "#ffc933", "#f4f0fa"];
  confettiLayer.innerHTML = "";
  for (let i = 0; i < 36; i++) {
    const piece = document.createElement("i");
    piece.className = "confetti";
    piece.style.left = Math.random() * 100 + "%";
    piece.style.background = colors[i % colors.length];
    piece.style.animationDelay = Math.random() * 0.6 + "s";
    piece.style.animationDuration = (2 + Math.random() * 1.5) + "s";
    confettiLayer.appendChild(piece);
  }
  setTimeout(function () { confettiLayer.innerHTML = ""; }, 4500);
}

/* =====================================================
   10. TIMER BAR
   ===================================================== */

// Resizes the white bar to match the time left (100% -> 0%)
function updateTimerBar() {
  const percent = (timeLeftMs / (TURN_SECONDS * 1000)) * 100;
  timerBar.style.width = percent + "%";
  hudTimer.textContent = Math.ceil(timeLeftMs / 1000); // whole seconds in the HUD tile
  // Turn red for the last 3 seconds as a warning
  const isLow = timeLeftMs <= 3000;
  timerBar.classList.toggle("low", isLow);
  hudTimerTile.classList.toggle("low", isLow);
}

// Stops the countdown (used on a guess or a timeout)
function stopTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
}

// Starts a fresh 10 second countdown. At 0 it counts as a wrong guess.
function startTimer() {
  stopTimer();
  timeLeftMs = TURN_SECONDS * 1000;
  updateTimerBar();

  timerInterval = setInterval(function () {
    timeLeftMs -= TICK_MS;
    if (timeLeftMs <= 0) {
      timeLeftMs = 0;
      updateTimerBar();
      handleGuess("timeout");
    } else {
      updateTimerBar();
    }
  }, TICK_MS);
}

/* =====================================================
   11. PHASE 3: GAMEPLAY
   ===================================================== */

// Called by "Tap to Start Turn": resets the player's score and shows round 1.
// It is "async" because it waits for the two cover images to finish loading,
// so the screen never appears with empty pictures.
async function startTurn() {
  startTurnBtn.disabled = true; // blocks double taps while we wait
  currentScore = 0;
  currentStreak = 0;
  isLocked = false;

  animeA = pickRandomAnime([]);
  animeB = pickRandomAnime([animeA.id]); // B must differ from A
  animeC = null;

  await waitForImages([animeA.coverImage.extraLarge, animeB.coverImage.extraLarge], 3000);
  startTurnBtn.disabled = false;

  // Clear any leftover animation classes from the last turn
  vsBadge.classList.remove("on-fire", "vs-hide");
  panelB.classList.remove("slide-active");
  panelC.classList.remove("fade-in");
  board.classList.remove("shake");
  flashOverlay.classList.remove("play", "correct", "wrong");

  fillPanel("a", animeA, true);
  fillPanel("b", animeB, false);
  setGuessButtonsDisabled(false);
  updateHud();
  showScreen("game-screen");
  startTimer();
}

// Handles a guess: "higher", "lower", or "timeout" (clock ran out)
function handleGuess(choice) {
  if (isLocked) { return; } // ignore double taps
  isLocked = true;
  stopTimer();
  setGuessButtonsDisabled(true);
  vibrate(15); // tiny tap feedback

  // Compare. If both numbers are equal, either guess counts as correct.
  let isCorrect = false;
  if (choice === "higher") { isCorrect = animeB.popularity >= animeA.popularity; }
  if (choice === "lower") { isCorrect = animeB.popularity <= animeA.popularity; }

  // Count B's number up, and only then show the verdict
  countUp(document.getElementById("pop-b"), animeB.popularity, 700, function () {
    if (isCorrect) {
      handleCorrectGuess();
    } else {
      handleWrongGuess(choice === "timeout");
    }
  });
}

// Correct: +1 point, maybe start the fire, then slide to the next anime
function handleCorrectGuess() {
  currentScore++;
  currentStreak++;
  players[currentPlayerIndex].bestStreak = Math.max(players[currentPlayerIndex].bestStreak, currentStreak);
  updateHud();
  restartClass(plusOne, "pop");         // floating "+1"
  restartClass(hudStreakTile, "bump");  // streak tile bounces
  vibrate(25);

  if (currentStreak >= FIRE_STREAK) {
    vsBadge.classList.add("on-fire");
  }
  playFlash(true, "Correct. +1 point. Next title in a moment...");

  // Prepare the next anime (C) behind B now, so its image loads during the wait
  animeC = pickRandomAnime([animeA.id, animeB.id]);
  fillPanel("c", animeC, false);

  setTimeout(slideToNextRound, 1500);
}

// Wrong or timeout: save the score, shake the screen, show the answer for 2 seconds
function handleWrongGuess(wasTimeout) {
  players[currentPlayerIndex].score = currentScore;
  restartClass(board, "shake");
  vibrate([60, 40, 60]);

  const answer = animeB.popularity >= animeA.popularity ? "higher" : "lower";
  const prefix = wasTimeout ? "Time's up." : "Not quite.";
  const name = players[currentPlayerIndex].name;
  const pointsWord = currentScore === 1 ? " point." : " points.";
  playFlash(false, prefix + " It was " + answer + ". " + name + "'s run ends at " + currentScore + pointsWord);

  setTimeout(goToNextPlayer, 2000);
}

// The slide animation: B glides into A's spot while C fades in behind it
function slideToNextRound() {
  statusB.textContent = "";             // clear the status line
  document.getElementById("eyebrow-b").textContent = EYEBROW_A; // B is about to become A
  vsBadge.classList.add("vs-hide");     // shrink the VS circle away
  panelB.classList.add("slide-active"); // CSS slides B up (portrait) or left (landscape)
  panelC.classList.add("fade-in");      // CSS fades C in
  setTimeout(finishSlide, SLIDE_MS);    // wait for the CSS animation to end
}

// After the slide: shuffle the data (B becomes A, C becomes B) and reset the CSS
// B and C look identical to the new A and B, so nothing visibly jumps.
function finishSlide() {
  animeA = animeB;
  animeB = animeC;
  animeC = null;

  fillPanel("a", animeA, true);
  fillPanel("b", animeB, false);

  // Removing these classes snaps everything back to the normal position instantly
  panelB.classList.remove("slide-active");
  panelC.classList.remove("fade-in");
  vsBadge.classList.remove("vs-hide"); // VS circle pops back in

  setGuessButtonsDisabled(false);
  isLocked = false;
  startTimer(); // fresh 10 seconds
}

// After a loss: next player's handoff, or the scoreboard if that was the last player
function goToNextPlayer() {
  if (currentPlayerIndex < players.length - 1) {
    currentPlayerIndex++;
    showHandoff();
  } else {
    showScoreboard();
  }
}

/* =====================================================
   12. PHASE 4: SCOREBOARD
   ===================================================== */

// Small helper: makes <span class="...">text</span>
function makeSpan(className, text) {
  const span = document.createElement("span");
  span.className = className;
  span.textContent = text;
  return span;
}

// Sorts players high to low and builds the leaderboard rows
function showScoreboard() {
  // slice() copies the array so the original order stays untouched
  const sorted = players.slice().sort(function (a, b) { return b.score - a.score; });
  const topScore = sorted[0].score;

  // Headline sentence: one winner, or a tie
  const winnerNames = sorted
    .filter(function (player) { return player.score === topScore; })
    .map(function (player) { return player.name; });
  const pointsText = topScore + (topScore === 1 ? " point." : " points.");
  if (winnerNames.length === 1) {
    winnerLine.textContent = winnerNames[0] + " takes the win with " + pointsText;
  } else {
    winnerLine.textContent = winnerNames.join(" and ") + " tie for the win with " + pointsText;
  }

  scoreList.innerHTML = ""; // empty the list before rebuilding it
  let rank = 0;
  let previousScore = null;

  for (let i = 0; i < sorted.length; i++) {
    const player = sorted[i];

    // Players with the same score share the same rank
    if (player.score !== previousScore) {
      rank = i + 1;
      previousScore = player.score;
    }

    const row = document.createElement("li");
    row.className = "score-row";
    if (player.score === topScore) { row.classList.add("winner"); } // gold styling
    // Rows drop in from the bottom up, so first place appears last
    row.style.animationDelay = ((sorted.length - 1 - i) * 150) + "ms";

    // Rank number and a round avatar with the player's first letter
    row.appendChild(makeSpan("rank", String(rank).padStart(2, "0")));
    const avatar = makeSpan("avatar", player.name.charAt(0).toUpperCase());
    if (player.score === topScore) { avatar.appendChild(makeSpan("crown", "👑")); }
    row.appendChild(avatar);

    // Name and best streak (textContent keeps typed names safe)
    const who = document.createElement("div");
    who.className = "who";
    const nameEl = document.createElement("b");
    nameEl.textContent = player.name;
    const streakEl = document.createElement("small");
    streakEl.textContent = "Best streak: " + player.bestStreak;
    who.appendChild(nameEl);
    who.appendChild(streakEl);
    row.appendChild(who);

    // Big score number with a tiny "Points" label
    const pts = document.createElement("div");
    pts.className = "score-pts";
    const scoreEl = document.createElement("b");
    scoreEl.textContent = player.score;
    const labelEl = document.createElement("small");
    labelEl.textContent = "Points";
    pts.appendChild(scoreEl);
    pts.appendChild(labelEl);
    row.appendChild(pts);

    scoreList.appendChild(row);
  }

  showScreen("scoreboard-screen");
  // Confetti lands just as the winner's row appears
  setTimeout(launchConfetti, (sorted.length - 1) * 150 + 250);
}

/* =====================================================
   13. START-UP: connect buttons to functions
   ===================================================== */

function init() {
  // Fill the setup form from the last session (or start with 1 empty field)
  const savedNames = loadSavedNames();
  const startCount = savedNames.length > 0 ? savedNames.length : 1;
  playerCountInput.value = startCount;
  renderNameFields(startCount, savedNames);

  // Setup screen events
  playerCountInput.addEventListener("input", handlePlayerCountInput);
  playerCountInput.addEventListener("blur", handlePlayerCountBlur);
  clearNamesBtn.addEventListener("click", handleClearNames);
  startBtn.addEventListener("click", handleStartClick);
  minusBtn.addEventListener("click", function () { changePlayerCount(-1); });
  plusBtn.addEventListener("click", function () { changePlayerCount(1); });

  // Handoff and gameplay events
  startTurnBtn.addEventListener("click", startTurn);
  higherBtn.addEventListener("click", function () { handleGuess("higher"); });
  lowerBtn.addEventListener("click", function () { handleGuess("lower"); });

  // Scoreboard event: back to setup (names stay filled in)
  playAgainBtn.addEventListener("click", function () {
    confettiLayer.innerHTML = "";
    showScreen("setup-screen");
  });

  // Fetch the anime once, in the background, while the player fills in names
  loadAnimeData();
}

init();
