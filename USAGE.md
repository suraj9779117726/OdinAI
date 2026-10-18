# ODIN Command Center — Usage Guide

**Live app:** [suraj9779117726.github.io/OdinAI](https://suraj9779117726.github.io/OdinAI/)

ODIN is a browser-based command center for simple task tracking and local CSV summaries. Commands are matched by a small, predefined parser; ODIN does not use an AI model to interpret arbitrary requests.

## Run a command

Type a command in the command line and press **Enter** or select **Run command**. You can also click one of the example commands on the welcome screen. The progress panel shows the operation while it runs. To see the supported command examples in the app, enter `Help`.

Supported commands:

| What you want to do | Example |
| --- | --- |
| Check browser and app capabilities | `Show my system status` |
| Add a task | `Create a task to prepare my presentation` |
| Open the task list | `Show my tasks` |
| Analyze a CSV already uploaded in this session | `Analyze my uploaded sales CSV` |
| See the command guide | `Help` |

Task creation also accepts `Add a task to ...` or `Make a task to ...`. Commands outside the supported set will show a message rather than being sent to an AI or backend.

## Manage tasks

Open **Tasks** from the sidebar, or use `Show my tasks`. Create tasks from the command line. Use the checkbox to mark a task complete or reopen it, and the trash button to delete it. Task counts and completion progress update automatically.

Tasks are saved in this browser’s local storage and remain after a page refresh on the same browser and device. They are not synced to other browsers or devices. If browser storage is disabled or unavailable, the app indicates that changes might not persist.

## Analyze a CSV

Open **Data lab** or enter `Analyze my uploaded sales CSV`, then choose a `.csv` file. Analysis is performed in the browser; files are not uploaded. The app shows the number of data rows and columns and, when numeric columns are available, a chart of up to the first eight values plus average, minimum, and maximum.

The file must have a header row and at least one data row. Every row must have the same number of columns, and column headers must be unique. Quoted fields and commas inside quoted fields are supported. Files larger than 10 MB are rejected. Uploading another file replaces the current analysis; **Clear uploaded data** removes it from the current session.

## Voice input and system status

Select the microphone button to dictate a command if your browser supports speech recognition. Depending on the browser, microphone permission and a secure connection may be required. If voice input is unavailable or denied, type commands instead.

The clock uses your device’s local time. Online/offline status comes from the browser’s network status, and the status panel reports browser capabilities such as local storage and speech recognition. These indicators describe the browser environment, not a remote server or device-health monitoring service.

## Run locally

Install [Node.js](https://nodejs.org/) (which includes npm), then run:

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. To verify a production build:

```sh
npm run build
```

The app is configured for the GitHub Pages repository path `/OdinAI/`. Pushing changes to the `main` branch builds and deploys the site with GitHub Actions.
