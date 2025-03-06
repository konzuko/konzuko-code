/*
  This file contains an alternate or older approach to storing
  app state. You appear to be using hooks.js now,
  so you may not need the entire file.

  Shown here for completeness, unchanged except for comments.
*/

import { useState, useEffect } from 'preact/hooks';
import { summarizeConversation } from './api.js';

const LOCAL_STORAGE_KEY = 'konzuko-chats';
const LOCAL_STORAGE_SETTINGS_KEY = 'konzuko-settings';
const MAX_TOKENS = 50000; // Token limit before memory management kicks in