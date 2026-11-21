# Third-party icons

- **Fluent Emoji (flat)** – (c) Microsoft Corporation, MIT License – https://github.com/microsoft/fluentui-emoji
  (taken from the @iconify-json/fluent-emoji-flat package). Used for the colour icons across the tool.
- **Simple Icons** – CC0 1.0 – https://simpleicons.org. Used for platform logos (WhatsApp, Facebook, Instagram, Telegram, Google, X, Snapchat, Apple, PhonePe, Google Pay, Jio, Airtel, Vi, Paytm, YouTube, Threads).
  The logos are trademarks of their owners and are shown only to name each platform.

MIT License (Fluent Emoji): Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.

# Licence signing and the Windows EXE

- **TweetNaCl.js** 1.0.3 (`src/js/lib/nacl-fast.min.js`) – public domain (The Unlicense) – https://github.com/dchest/tweetnacl-js. Signs and checks the Desktop licence keys.
- **Electron** – MIT License – https://www.electronjs.org (the Windows EXE in `desktop/`, with Chromium and its own licences listed in the installed `LICENSES.chromium.html`).
- **electron-builder** and **resedit** – MIT License – used only to build the setup.

# Reference databases (data/*.gz, downloaded once by every copy of the tool and kept offline)

- **IFSC list** (`data/ifsc-data.gz`) – RBI / NPCI bank branch lists as compiled by https://github.com/razorpay/ifsc (MIT; data stated public domain by the publisher).
- **PIN codes** (`data/pin-data.gz`) – India Post PIN directory with LGD district codes, from https://github.com/bilal-webdev/india-postal-pincode-dataset (MIT).
- **Mobile series and landline STD codes** (`data/mob-data.gz`) – mobile series → operator / circle from the Wikipedia article
  “Mobile telephone numbering in India” (CC BY-SA 4.0, https://creativecommons.org/licenses/by-sa/4.0/), as extracted by https://github.com/dharunashokkumar/api.dharun.dev;
  operator prefixes and landline places from Google libphonenumber (Apache-2.0, https://github.com/google/libphonenumber, via python-phonenumbers).
  The mobile-series part is shared under the same CC BY-SA 4.0 licence. The series shows the operator a number was first given to; MNP can move it.
- **IP ranges of India** (`data/ip-data.gz`) – IP Geolocation by DB-IP, https://db-ip.com (DB-IP Lite, CC BY 4.0); IP to ASN by RouteViews and DB-IP (CC BY 4.0), packed by https://github.com/sapics/ip-location-db.
- **IMEI TAC → brand / model** (`src/js/tacdata.js`) – TAC Database by Moaz Ebrahem, https://github.com/MoazEb/tac-database (MIT).

# 7z reader

- **7-Zip 24.09** compiled to WebAssembly (npm package 7z-wasm 1.2.0, https://github.com/use-strict/7z-wasm) in `src/js/lib/sevenzip.js` – (c) Igor Pavlov,
  GNU LGPL 2.1 with the unRAR restriction (https://www.7-zip.org/license.txt). Used only to open .7z files on the officer's own computer.

# Forensic Modules (Image / File Analysis)

- **jsQR** 1.4.0 (`src/js/lib/jsqr.js`) – Apache License 2.0 – https://github.com/cozmo/jsQR. Reads QR codes in pictures, PDF pages and documents.
- **UTIF.js** 3.1.0 (`src/js/lib/utif.js`) – MIT License – https://github.com/photopea/UTIF.js. Opens TIFF pictures.

# Forensic Modules – AI Speech Pack (`speech-ai.js`, loaded only when an 🤖 AI button is pressed; runs on the officer's computer)

- **Transformers.js** 4.3.2 (Hugging Face) – Apache License 2.0 – https://github.com/huggingface/transformers.js
- **ONNX Runtime Web** 1.31 (Microsoft) – MIT License – https://github.com/microsoft/onnxruntime
- **Whisper tiny** speech model (OpenAI) – MIT License – https://github.com/openai/whisper; ONNX 8-bit conversion "Xenova/whisper-tiny" as packed in the npm package `sts-whisper-tiny` 1.0.0 (Apache License 2.0).
  Speech-to-text, translation to English and language detection are machine output and are marked as preliminary in the tool.
- Audio / video readers, waveform, spectrogram, voice-activity, noise, enhancement and voice grouping in `src/js/fx_media.js` are the tool's own code.
