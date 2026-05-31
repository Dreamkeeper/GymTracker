// src/pkjs/index.js

// ============================================================
// CONFIGURATION
// ============================================================
var CONFIG = {
  isDevMode: false,
  configUrlDev:  'https://oliverano95.github.io/GymTracker/index_dev.html',
  configUrlProd: 'https://oliverano95.github.io/GymTracker/',
  maxHistory: 15
};

// ============================================================
// STORAGE HELPERS
// Centralise all localStorage access so key names are never
// scattered as magic strings throughout the code.
// ============================================================
var Storage = {
  get: function(key, fallback) {
    var val = localStorage.getItem(key);
    return val !== null ? val : (fallback !== undefined ? fallback : null);
  },
  set: function(key, value) {
    localStorage.setItem(key, value);
  },
  remove: function(key) {
    localStorage.removeItem(key);
  },
  getJSON: function(key, fallback) {
    try {
      var val = localStorage.getItem(key);
      return val !== null ? JSON.parse(val) : fallback;
    } catch (e) {
      console.log('Storage.getJSON parse error for key "' + key + '": ' + e);
      return fallback;
    }
  },
  setJSON: function(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }
};

// ============================================================
// GOOGLE SHEETS EXPORT
// Isolated so it can be called from anywhere without
// duplicating XHR boilerplate.
// ============================================================
function exportToGoogleSheets(rawData) {
  var scriptUrl = Storage.get('googleUrl');
  var scriptPwd = Storage.get('googlePwd');
  if (!scriptUrl || !scriptPwd) return;

  console.log('Google Sheets config found. Uploading...');
  var req = new XMLHttpRequest();
  req.open('POST', scriptUrl, true);
  req.setRequestHeader('Content-Type', 'application/json');

  req.onload = function() {
    console.log('Successfully logged workout to Google Sheets! Status: ' + req.status);
  };
  req.onerror = function() {
    console.log('Network error while uploading to Google Sheets.');
  };

  req.send(JSON.stringify({ token: scriptPwd, workoutData: rawData }));
}

// ============================================================
// WORKOUT HISTORY
// ============================================================
function saveWorkoutLocally(rawData) {
  // Validate payload size before storing to prevent localStorage bloat
  if (!rawData || rawData.length > 4096) {
    console.log('Workout payload missing or oversized, skipping local save.');
    return;
  }

  var history = Storage.getJSON('workoutHistory', []);
  history.push({ timestamp: new Date().getTime(), data: rawData });

  // Cap history so the config URL never gets too long to load
  if (history.length > CONFIG.maxHistory) history.shift();

  Storage.setJSON('workoutHistory', history);
  console.log('Workout saved locally. History count: ' + history.length);
}

// ============================================================
// ROUTINE PARSER (Two-Way Sync)
// Extracted from the appmessage handler so it is testable and
// readable independently.
// ============================================================
function parseRoutineString(syncString) {
  var parts = syncString.split('|');
  if (parts.length < 2) return null;

  var routineName = parts[0];
  var progressionMode = '-1';
  var weightIncrement = '2';
  var startIndex = 1;

  // Detect optional progression header: parts[1] will be "-1", "0", or "1"
  // FIX: use explicit set membership instead of fragile string matching
  var PROGRESSION_VALUES = { '-1': true, '0': true, '1': true };
  if (parts.length > 2 && PROGRESSION_VALUES[parts[1]] !== undefined) {
    progressionMode = parts[1];
    weightIncrement = parts[2];
    startIndex = 3;
  }

  var exercises = [];
  for (var i = startIndex; i < parts.length; i += 6) {
    // Guard against incomplete trailing fields
    if (!parts[i] || i + 5 >= parts.length) break;
    exercises.push({
      name:      parts[i],
      sets:      parseInt(parts[i + 1], 10),
      reps:      parseInt(parts[i + 2], 10),
      weight:    parseInt(parts[i + 3], 10),
      modifier:  parseInt(parts[i + 4], 10),
      comment:   parts[i + 5] === '-' ? '' : parts[i + 5]
    });
  }

  return {
    name:            routineName,
    exercises:       exercises,
    progressionMode: progressionMode,
    weightIncrement: weightIncrement
  };
}

function autoSyncRoutine(syncString, routineName, parsedRoutine) {
  var savedRoutines = Storage.getJSON('savedRoutines', []);
  var existingIndex = -1;
  for (var i = 0; i < savedRoutines.length; i++) {
    if (savedRoutines[i].name === routineName) { existingIndex = i; break; }
  }

  if (existingIndex >= 0) {
    savedRoutines[existingIndex] = parsedRoutine;
  } else {
    savedRoutines.push(parsedRoutine);
  }

  Storage.setJSON('savedRoutines', savedRoutines);
  Storage.set('lastRoutine', routineName);
  console.log('Auto-synced routine updated in background: ' + routineName);
}

// ============================================================
// PEBBLE EVENT LISTENERS
// ============================================================

// 1. JS environment ready
Pebble.addEventListener('ready', function() {
  console.log('PebbleKit JS ready.');
});

// 2. User tapped "Settings" on the watch
Pebble.addEventListener('showConfiguration', function() {
  var baseUrl = CONFIG.isDevMode ? CONFIG.configUrlDev : CONFIG.configUrlProd;

  var googleUrl = Storage.get('googleUrl', '');
  var googlePwd = Storage.get('googlePwd', '');
  var syncedRoutines = Storage.get('synced_routines', '{}');
  var historyArr = Storage.getJSON('workoutHistory', []);

  var url = '';
  var SAFE_URL_LIMIT = 7000; // GitHub Pages rejects URLs over ~8KB, so we leave breathing room

  // Dynamically trim history to ensure the URL never exceeds the server limit
  while (historyArr.length >= 0) {
    var params = [
      'googleUrl='  + encodeURIComponent(googleUrl),
                        'googlePwd='  + encodeURIComponent(googlePwd),
                        'history='    + encodeURIComponent(JSON.stringify(historyArr)),
                        'sync='       + encodeURIComponent(syncedRoutines)
    ];

    url = baseUrl + '?' + params.join('&');

    // If it fits, or if we have deleted all history, break the loop and send it
    if (url.length <= SAFE_URL_LIMIT || historyArr.length === 0) {
      break;
    }

    // URL is too long! Remove the oldest workout from this payload and try again.
    historyArr.shift();
  }

  console.log('Opening config page. Final URL length: ' + url.length);
  Pebble.openURL(url);
});

// 3. Configuration web page closed
Pebble.addEventListener('webviewclosed', function(e) {
  if (!e.response || e.response === 'CANCELLED' || e.response === '[]') return;

  var configData;
  try {
    configData = JSON.parse(decodeURIComponent(e.response));
  } catch (err) {
    // FIX: guard against malformed JSON instead of crashing the JS runtime
    console.log('webviewclosed: failed to parse response: ' + err);
    return;
  }

  // --- Credentials ---
  if (configData.clearGoogle) {
    Storage.remove('googleUrl');
    Storage.remove('googlePwd');
    console.log('Google Sync credentials wiped.');
  } else {
    if (configData.googleUrl && configData.googleUrl.trim() !== '') {
      Storage.set('googleUrl', configData.googleUrl);
    }
    if (configData.googlePwd && configData.googlePwd.trim() !== '') {
      Storage.set('googlePwd', configData.googlePwd);
    }
  }

  // --- History ---
  if (configData.clearHistory) {
    Storage.setJSON('workoutHistory', []);
  }

  // --- Two-Way Sync routines ---
  if (configData.updatedSync !== undefined) {
    Storage.setJSON('synced_routines', configData.updatedSync);
  }

  // --- Send data to watch ---
  var appMessageData = {};

  if (configData.routineData && configData.routineData !== '') {
    appMessageData['ROUTINE_DATA'] = configData.routineData;
  }
  if (configData.progressionMode !== undefined) {
    appMessageData['PROGRESSION_MODE'] = parseInt(configData.progressionMode, 10);
  }
  if (configData.weightIncrement !== undefined) {
    appMessageData['WEIGHT_INCREMENT'] = parseInt(configData.weightIncrement, 10);
  }

  if (Object.keys(appMessageData).length > 0) {
    Pebble.sendAppMessage(appMessageData,
      function()    { console.log('Data sent to watch successfully.'); },
      function(err) { console.log('Failed to send data to watch: ' + JSON.stringify(err)); }
    );
  }
});

// 4. Message received FROM the watch
Pebble.addEventListener('appmessage', function(e) {
  var payload = e.payload;

  // --- Workout complete ---
  if (payload.WORKOUT_SUMMARY) {
    var rawData = payload.WORKOUT_SUMMARY;
    console.log('WORKOUT COMPLETE. Received ' + rawData.length + ' chars.');
    saveWorkoutLocally(rawData);
    exportToGoogleSheets(rawData);
  }

  // --- Two-Way Sync: routine sent from watch ---
  if (payload.ROUTINE_DATA) {
    var syncString  = payload.ROUTINE_DATA;
    var routineName = syncString.split('|')[0];

    // Always persist the raw string for the manual sync box
    var syncedRoutines = Storage.getJSON('synced_routines', {});
    syncedRoutines[routineName] = syncString;
    Storage.setJSON('synced_routines', syncedRoutines);
    console.log('Two-Way Sync saved for: ' + routineName);

    // Background auto-sync if the user has enabled it
    if (Storage.get('autoSyncEnabled') === 'true') {
      var parsed = parseRoutineString(syncString);
      if (parsed) {
        autoSyncRoutine(syncString, routineName, parsed);
      } else {
        console.log('Auto-sync skipped: could not parse routine string.');
      }
    }
  }
  // --- Voice Add Exercise Interceptor ---
  if (payload.VOICE_ADD_EXERCISE) {
    var spokenText = payload.VOICE_ADD_EXERCISE.toLowerCase();
    console.log("Voice dictation received: " + spokenText);

    // Convert written numbers to digits for easier regex matching
    var numWords = { "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "fifteen": 15, "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50 };
    for (var word in numWords) {
      spokenText = spokenText.replace(new RegExp('\\b' + word + '\\b', 'gi'), numWords[word]);
    }

    var exerciseName = "Unknown Exercise";
    var sets = 3;
    var reps = 10;
    var weight = 0;

    // Parse Sets
    var setsMatch = spokenText.match(/(\d+)\s*sets?/);
    if (setsMatch) sets = parseInt(setsMatch[1], 10);

    // Parse Reps
    var repsMatch = spokenText.match(/(\d+)\s*reps?/);
    if (!repsMatch) repsMatch = spokenText.match(/sets? of (\d+)/);
    if (repsMatch) reps = parseInt(repsMatch[1], 10);

    // Parse Weight
    var weightMatch = spokenText.match(/(\d+)\s*(kilos?|kg|lbs?|pounds|weight)/);
    if (weightMatch) {
      weight = parseInt(weightMatch[1], 10);
    } else if (spokenText.indexOf("bodyweight") !== -1 || spokenText.indexOf("body weight") !== -1) {
      weight = 0;
    }

    // Extract the Name (Everything before the sets block)
    var nameMatch = spokenText.match(/^(.*?)\s*\d+\s*sets?/);
    if (nameMatch && nameMatch[1]) {
      exerciseName = nameMatch[1].trim();
    } else {
      exerciseName = spokenText.substring(0, 20).trim(); // Fallback if user spoke improperly
    }

    // Capitalize first letter of each word
    exerciseName = exerciseName.replace(/\b\w/g, function(l){ return l.toUpperCase(); });

    var newExString = exerciseName + "|" + sets + "|" + reps + "|" + weight + "|0|-";

    // Beam it back to the watch!
    Pebble.sendAppMessage({ "NEW_EXERCISE_DATA": newExString },
                          function() { console.log("Sent parsed exercise back: " + newExString); },
                          function(err) { console.log("Failed to send parsed exercise: " + JSON.stringify(err)); }
    );
  }
});
