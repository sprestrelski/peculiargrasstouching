/**
 * @license
 * Copyright 2021 Google LLC. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * =============================================================================
 */

import '@tensorflow/tfjs-backend-webgl';
import * as mpHands from '@mediapipe/hands';
import * as tfjsWasm from '@tensorflow/tfjs-backend-wasm';

tfjsWasm.setWasmPaths(
    `https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-wasm@${
        tfjsWasm.version_wasm}/dist/`);

import * as handdetection from '@tensorflow-models/hand-pose-detection';

import {Camera} from './camera';
import {setupDatGui} from './option_panel';
import {STATE} from './shared/params';
import {setupStats} from './shared/stats_panel';
import {setBackendAndEnvFlags} from './shared/util';

let detector, camera, stats;
let score = 0;
let startInferenceTime, numInferences = 0;
let inferenceTimeSum = 0, lastPanelUpdate = 0;
let rafId;

var initTime = new Date();
function shareExperience() {
  const duration = (new Date() - initTime) / 1000;
  const formattedDuration = formatDuration(duration); 

  const copyText = `I touched grass today!
  ⏰ Started: ${initTime.toLocaleString()}
  💫 Duration: ${formattedDuration}
  🍀 Points: ${score}
  www.peculiargrasstouching.tech/`;

  navigator.clipboard.writeText(copyText).then(() => {
    alert('Text copied to clipboard!');
  }).catch((err) => {
    alert('Failed to copy text: ' + err);
  });
}

function formatDuration(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secondsLeft = Math.floor((seconds % 3600) % 60);

  const formattedHours = hours > 0 ? `${hours.toString().padStart(2, '0')}:` : '';
  const formattedMinutes = minutes.toString().padStart(2, '0');
  const formattedSeconds = secondsLeft.toString().padStart(2, '0');

  return `${formattedHours}${formattedMinutes}:${formattedSeconds}`;
}

document.getElementById("shareButton").addEventListener("click", shareExperience);

async function createDetector() {
  switch (STATE.model) {
    case handdetection.SupportedModels.MediaPipeHands:
      const runtime = STATE.backend.split('-')[0];
      if (runtime === 'mediapipe') {
        return handdetection.createDetector(STATE.model, {
          runtime,
          modelType: STATE.modelConfig.type,
          maxHands: STATE.modelConfig.maxNumHands,
          solutionPath: `https://cdn.jsdelivr.net/npm/@mediapipe/hands@${mpHands.VERSION}`
        });
      } else if (runtime === 'tfjs') {
        return handdetection.createDetector(STATE.model, {
          runtime,
          modelType: STATE.modelConfig.type,
          maxHands: STATE.modelConfig.maxNumHands
        });
      }
  }
}

async function checkGuiUpdate() {
  if (STATE.isTargetFPSChanged || STATE.isSizeOptionChanged) {
    camera = await Camera.setupCamera(STATE.camera);
    STATE.isTargetFPSChanged = false;
    STATE.isSizeOptionChanged = false;
  }

  if (STATE.isModelChanged || STATE.isFlagChanged || STATE.isBackendChanged) {
    console.log(STATE);
    STATE.isModelChanged = true;

    window.cancelAnimationFrame(rafId);

    if (detector != null) {
      detector.dispose();
    }

    if (STATE.isFlagChanged || STATE.isBackendChanged) {
      await setBackendAndEnvFlags(STATE.flags, STATE.backend);
    }

    try {
      detector = await createDetector(STATE.model);
    } catch (error) {
      detector = null;
      alert(error);
    }

    STATE.isFlagChanged = false;
    STATE.isBackendChanged = false;
    STATE.isModelChanged = false;
  }
}

function beginEstimateHandsStats() {
  startInferenceTime = (performance || Date).now();
}

function endEstimateHandsStats() {
  const endInferenceTime = (performance || Date).now();
  inferenceTimeSum += endInferenceTime - startInferenceTime;
  ++numInferences;

  const panelUpdateMilliseconds = 1000;
  if (endInferenceTime - lastPanelUpdate >= panelUpdateMilliseconds) {
    const averageInferenceTime = inferenceTimeSum / numInferences;
    inferenceTimeSum = 0;
    numInferences = 0;
    stats.customFpsPanel.update(
        1000.0 / averageInferenceTime, 120 /* maxValue */);
    lastPanelUpdate = endInferenceTime;
  }
}

var startTime = new Date()
var grassTime = new Date()
var grassIntervalInSeconds = 2
var past_pos_x, curr_pos_x = 0
var past_pos_y, curr_pos_y = 0
var past_pos_z, curr_pos_z = 0
const handStatusDiv = document.getElementById("hand-status");
const scoreDiv = document.getElementById("points");

async function renderResult() {
  if (camera.video.readyState < 2) {
    await new Promise((resolve) => {
      camera.video.onloadeddata = () => {
        resolve(video);
      };
    });
  }

  let hands = null;

  // Detector can be null if initialization failed (for example when loading
  // from a URL that does not exist).
  if (detector != null) {
    // FPS only counts the time it takes to finish estimateHands.
    beginEstimateHandsStats();

    // Detectors can throw errors, for example when using custom URLs that
    // contain a model that doesn't provide the expected output.
    try {
      hands = await detector.estimateHands(
          camera.video,
          {flipHorizontal: false});
    } catch (error) {
      detector.dispose();
      detector = null;
      alert(error);
    }

    endEstimateHandsStats();
  }

  camera.drawCtx();

  // The null check makes sure the UI is not in the middle of changing to a
  // different model. If during model change, the result is from an old model,
  // which shouldn't be rendered.
  //let coordsOut = document.getElementById("coords");
  //let directionOut = document.getElementById("direction");
  let intervalTimeInSeconds = 0.5
  let threshold = 0.005  
  let direction = ""
  
  let velocity_x, velocity_y, velocity_z = 0;

  if ( (new Date() - grassTime) / 1000 > grassIntervalInSeconds) {
    console.log("grass");
    grassTime = new Date();
    grassPrediction();
  }

  if (hands && hands.length > 0 && !STATE.isModelChanged) {
    camera.drawResults(hands);

    let point = hands[0].keypoints3D[0]
    curr_pos_x = point.x
    curr_pos_y = point.y

    if ( (new Date() - startTime) / 1000 > intervalTimeInSeconds) {
      velocity_x = Math.abs((curr_pos_x - past_pos_x)) / intervalTimeInSeconds;
      velocity_y = Math.abs((curr_pos_y - past_pos_y)) / intervalTimeInSeconds;
      
      handStatusDiv.classList.remove("active");
      if (velocity_x > threshold || velocity_y > threshold ) {
        direction = "moving";
        handStatusDiv.classList.add("active");
        handStatusDiv.innerHTML = "Petting in Progress"

        if (grassStatusDiv.classList.contains("active")) { // Check if grass is detected
          score += 1;
          scoreDiv.innerHTML = `Score: ${score}`;
        }
      } else {
        direction = "not moving"
        handStatusDiv.innerHTML = "Petulantly Patient..."
      }

      past_pos_x = curr_pos_x
      past_pos_y = curr_pos_y
      past_pos_z = curr_pos_z
      startTime = new Date();
    }

    //coordsOut.innerHTML = `(${curr_pos_x}, ${curr_pos_y}, ${curr_pos_z}), (${velocity_x}, ${velocity_y}, ${velocity_z})`
    //directionOut.innerHTML = `direction: ${direction}`
  } else {
    handStatusDiv.classList.remove("active");
    direction = "not moving"
    handStatusDiv.innerHTML = "Petulantly Patient..."
  }
}

const grassStatusDiv = document.getElementById("grass-status");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
async function grassPrediction() {
  // For text-and-image input (multimodal), use the gemini-pro-vision model
  const model = genAI.getGenerativeModel({ model: "gemini-pro-vision" });

  const prompt = "is there grass in this photo? output a percentage and a percentage only of how confident you are that this is grass. put it in the form [YES | NO] [NUMBER]%";
  const image = camera.canvas.toDataURL("image/jpeg");
  const imagePart = {
    inlineData: {
      data: image.split(',')[1], // Extract base64 data
      mimeType: 'image/jpeg',
    },
  };

  const result = await model.generateContent([prompt, imagePart]);
  const response = await result.response;
  const text = response.text();

  if (text.includes("YES")) {
    const textArray = text.split(" ");
    const confidenceLevel = parseFloat(textArray[2]);
    console.log(textArray);
    grassStatusDiv.innerHTML = `Grass detected (${confidenceLevel}%)! :D`;
    grassStatusDiv.classList.add("active");
  } else {
    const textArray = text.split(" ");
    const confidenceLevel = parseFloat(textArray[2]);
    console.log(textArray);
    grassStatusDiv.classList.remove("active");
    grassStatusDiv.innerHTML = "No grass detected D:";
  }
  console.log(text);
}

async function renderPrediction() {
  await checkGuiUpdate();

  if (!STATE.isModelChanged) {
    await renderResult();
  }

  rafId = requestAnimationFrame(renderPrediction);
};

async function app() {
  // Gui content will change depending on which model is in the query string.
  const urlParams = new URLSearchParams(window.location.search);
  if (!urlParams.has('model')) {
    urlParams.set('model', 'mediapipe_hands');
    window.location.search = urlParams;
    return;
  }

  await setupDatGui(urlParams);

  stats = setupStats();

  camera = await Camera.setupCamera(STATE.camera);

  await setBackendAndEnvFlags(STATE.flags, STATE.backend);

  detector = await createDetector();

  renderPrediction();
};

app();
