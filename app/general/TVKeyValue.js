/*
 * Copyright (c) 2017–present Felipe de Leon <fglfgl27@gmail.com>
 *
 * This file is part of SmartTwitchTV <https://github.com/fgl27/SmartTwitchTV>
 *
 * SmartTwitchTV is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * SmartTwitchTV is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with SmartTwitchTV.  If not, see <https://github.com/fgl27/SmartTwitchTV/blob/master/LICENSE>.
 *
 */

// webOS TV remote keymap. Adapted from upstream (Android) values to match
// LG webOS Magic Remote keycodes — the dedicated Back button generates
// keyCode 461, Enter is keyCode 13. Browser-dev users press Backspace (8)
// for "back"; the cases in upstream switches list both KEY_RETURN and
// KEY_KEYBOARD_BACKSPACE together so both platforms work.

var KEY_PAUSE = 19; // Pause media key (Magic Remote)
var KEY_PLAY = 415; // Play media key (Magic Remote)

var KEY_STOP = 413; // Stop media key
var KEY_PLAYPAUSE = 463; // PlayPause toggle key

var KEY_LEFT = 37;
var KEY_UP = 38;
var KEY_RIGHT = 39;
var KEY_DOWN = 40;
// KEY_ENTER = OK on the Magic Remote. MUST be distinct from KEY_PLAY so
// switch statements that case KEY_PLAY before KEY_ENTER don't collapse the
// two. Same code (13) used to mean "OK + Play + PlayPause" all at once,
// which made hold-OK impossible — case KEY_PLAY won the switch and ran the
// short-press action immediately, the KEY_ENTER hold-detect timer never
// armed. Keeping these separate restores Screens.js's hold-vs-click logic.
var KEY_ENTER = 13;

var KEY_PG_DOWN = 34; // Channel Down
var KEY_PG_UP = 33; // Channel Up

var KEY_RETURN = 461; // Back button on LG webOS
var KEY_ESCAPE = 461;

var KEY_KEYBOARD_BACKSPACE = 8;
var KEY_KEYBOARD_DONE = 13;
var KEY_KEYBOARD_SPACE = 32;

var KEY_MEDIA_NEXT = 176;
var KEY_MEDIA_PREVIOUS = 177;

var KEY_MEDIA_FAST_FORWARD = 228;
var KEY_MEDIA_REWIND = 227;

var KEY_0 = 48;
var KEY_1 = 49;
var KEY_2 = 50;
var KEY_3 = 51;
var KEY_4 = 52;
var KEY_5 = 53;
var KEY_6 = 54;
var KEY_7 = 55;
var KEY_8 = 56;
var KEY_9 = 57;

var KEY_NUMPAD_0 = 96;
var KEY_NUMPAD_1 = 97;
var KEY_NUMPAD_2 = 98;
var KEY_NUMPAD_3 = 99;
var KEY_NUMPAD_4 = 100;
var KEY_NUMPAD_5 = 101;
var KEY_NUMPAD_6 = 102;
var KEY_NUMPAD_7 = 103;
var KEY_NUMPAD_8 = 104;
var KEY_NUMPAD_9 = 105;

var KEY_A = 65;
var KEY_C = 67;
var KEY_E = 69;
var KEY_J = 74;
var KEY_K = 75;
var KEY_T = 84;
var KEY_U = 85;
