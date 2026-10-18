import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const TASKS_KEY = "odin-command-center-tasks";
const EXAMPLES = [
  "Show my system status",
  "Create a task to prepare my presentation",
  "Show my tasks",
  "Analyze my uploaded sales CSV",
  "Help",
];

function getSpeechRecognition() {
  return typeof window !== "undefined"
    ? window.SpeechRecognition || window.webkitSpeechRecognition || null
    : null;
}

function readTasks() {
  try {
    const saved = localStorage.getItem(TASKS_KEY);
    const parsed = saved ? JSON.parse(saved) : [];
    return Array.isArray(parsed)
      ? parsed.filter((task) => task && typeof task.id === "string" && typeof task.title === "string")
      : [];
  } catch {
    return [];
  }
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const source = text.replace(/^\uFEFF/, "");

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"' && cell.length === 0) {
      quoted = true;
    } else if (char === ",") {
      row.push(cell.trim());
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      row.push(cell.trim());
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (quoted) throw new Error("This CSV has an unclosed quote. Check the file and try again.");
  row.push(cell.trim());
  if (row.some((value) => value !== "")) rows.push(row);
  if (rows.length < 2) throw new Error("The CSV needs a header row and at least one data row.");

  const headers = rows[0].map((header, index) => header || `Column ${index + 1}`);
  if (new Set(headers).size !== headers.length) {
    throw new Error("Column names must be unique so the data can be summarized correctly.");
  }
  const dataRows = rows.slice(1);
  const malformedRow = dataRows.findIndex((dataRow) => dataRow.length !== headers.length);
  if (malformedRow !== -1) {
    throw new Error(`Row ${malformedRow + 2} has ${dataRows[malformedRow].length} values; expected ${headers.length}.`);
  }

  const numericColumns = headers.map((header, columnIndex) => {
    const values = dataRows.map((dataRow) => dataRow[columnIndex]);
    const numbers = values.map((value) => value.trim() === "" ? NaN : Number(value));
    const presentValues = values.filter((value) => value !== "");
    const isNumeric = presentValues.length > 0 && numbers.every((number, index) => values[index] === "" || Number.isFinite(number));
    if (!isNumeric) return null;
    const numericValues = numbers.filter(Number.isFinite);
    return {
      name: header,
      values: numericValues.slice(0, 8),
      average: numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length,
      minimum: Math.min(...numericValues),
      maximum: Math.max(...numericValues),
    };
  }).filter(Boolean);

  return { headers, rowCount: dataRows.length, numericColumns };
}

function Icon({ name, size = 18 }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
  };
  const paths = {
    command: <><path d="M8 4H6a2 2 0 0 0-2 2v2" /><path d="M16 4h2a2 2 0 0 1 2 2v2" /><path d="M8 20H6a2 2 0 0 1-2-2v-2" /><path d="M16 20h2a2 2 0 0 0 2-2v-2" /><path d="M8 12h8" /><path d="M12 8v8" /></>,
    arrow: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
    mic: <><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0" /><path d="M12 18v3m-4 0h8" /></>,
    upload: <><path d="M12 16V4" /><path d="m7 9 5-5 5 5" /><path d="M4 20h16" /></>,
    check: <><path d="m5 12 4 4L19 6" /></>,
    trash: <><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="m19 6-1 14H6L5 6" /><path d="M10 11v5m4-5v5" /></>,
    chart: <><path d="M4 19V5" /><path d="M4 19h17" /><path d="m7 15 4-4 3 2 5-6" /></>,
    spark: <><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" /><path d="m19 16 .8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z" /></>,
    close: <><path d="m18 6-12 12M6 6l12 12" /></>,
  };
  return <svg {...common}>{paths[name]}</svg>;
}

function App() {
  const [tasks, setTasks] = useState(readTasks);
  const [command, setCommand] = useState("");
  const [clock, setClock] = useState(new Date());
  const [workflow, setWorkflow] = useState(null);
  const [notice, setNotice] = useState(null);
  const [csv, setCsv] = useState(null);
  const [csvError, setCsvError] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [storageAvailable, setStorageAvailable] = useState(true);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [resultPanel, setResultPanel] = useState("welcome");
  const [greeting, setGreeting] = useState("");
  const recognitionRef = useRef(null);
  const timerRef = useRef([]);
  const fileInputRef = useRef(null);
  const commandInputRef = useRef(null);
  const speechSupported = Boolean(getSpeechRecognition());

  useEffect(() => {
    const tick = window.setInterval(() => setClock(new Date()), 1000);
    return () => window.clearInterval(tick);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
      setStorageAvailable(true);
    } catch {
      setStorageAvailable(false);
    }
  }, [tasks]);

  useEffect(() => {
    const updateOnline = () => setIsOnline(navigator.onLine);
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    return () => {
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
    };
  }, []);

  useEffect(() => () => {
    timerRef.current.forEach(window.clearTimeout);
    recognitionRef.current?.stop();
  }, []);

  const completedCount = useMemo(() => tasks.filter((task) => task.completed).length, [tasks]);
  const pendingCount = tasks.length - completedCount;

  const runWorkflow = useCallback((title, steps, action) => {
    timerRef.current.forEach(window.clearTimeout);
    timerRef.current = [];
    setNotice(null);
    setWorkflow({ title, step: 0, steps });
    steps.forEach((step, index) => {
      const timer = window.setTimeout(() => {
        setWorkflow({ title, step: index + 1, steps });
        if (index === steps.length - 1) {
          action();
          const finishTimer = window.setTimeout(() => setWorkflow(null), 550);
          timerRef.current.push(finishTimer);
        }
      }, (index + 1) * 420);
      timerRef.current.push(timer);
    });
  }, []);

  const announce = useCallback((message, kind = "success") => {
    setNotice({ message, kind });
  }, []);

  const addTask = useCallback((title) => {
    const cleaned = title.trim().replace(/[.!?]+$/, "");
    if (!cleaned) {
      announce("Add a task description after “create a task to”.", "error");
      return false;
    }
    setTasks((current) => [{ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, title: cleaned, completed: false, createdAt: new Date().toISOString() }, ...current]);
    setResultPanel("tasks");
    announce(`Task added: ${cleaned}`);
    return true;
  }, [announce]);

  const processCommand = useCallback((rawCommand) => {
    const input = rawCommand.trim();
    if (!input) {
      announce("Type a command or choose an example to get started.", "error");
      commandInputRef.current?.focus();
      return;
    }
    setCommand(input);
    setGreeting("");
    const normalized = input.toLowerCase().replace(/[.!?]+$/, "").trim();

    if (/^(help|show help|what can you do|list commands)$/.test(normalized)) {
      runWorkflow("Command guide", ["Reading command library", "Preparing supported actions"], () => {
        setResultPanel("help");
        announce("Command guide is ready.");
      });
      return;
    }
    if (/^(show|check|get|what is|what's)?\s*(my\s+)?(system\s+)?status$/.test(normalized)) {
      runWorkflow("System status", ["Checking browser capabilities", "Reading live system signals"], () => {
        setResultPanel("status");
        announce("Live system status updated.");
      });
      return;
    }
    const taskMatch = input.match(/^(?:please\s+)?(?:create|add|make)\s+(?:a\s+)?task(?:\s+to|\s*:\s*|\s+for)?\s+(.+)$/i);
    if (taskMatch) {
      runWorkflow("Creating task", ["Validating task details", "Saving to this browser"], () => addTask(taskMatch[1]));
      return;
    }
    if (/^(show|list|view|display)?\s*(my\s+)?tasks$/.test(normalized)) {
      runWorkflow("Task list", ["Loading saved tasks", "Counting open items"], () => {
        setResultPanel("tasks");
        announce(`Task list loaded: ${pendingCount} open, ${completedCount} complete.`);
      });
      return;
    }
    if (/^(analyze|analyse|show|check)\s+(my\s+)?(uploaded\s+)?(sales\s+)?csv$/.test(normalized)
      || /^(analyze|analyse)\s+(my\s+)?(uploaded\s+)?(sales\s+)?(csv|file|data)$/.test(normalized)) {
      runWorkflow("CSV analysis", ["Checking local file", "Calculating column statistics", "Building chart"], () => {
        if (!csv) {
          setResultPanel("csv");
          announce("Upload a CSV file first. It will be analyzed locally in your browser.", "error");
          return;
        }
        setResultPanel("csv");
        announce(`Analysis ready: ${csv.rowCount} rows across ${csv.headers.length} columns.`);
      });
      return;
    }
    runWorkflow("Checking command", ["Matching supported commands"], () => {
      setResultPanel("help");
      announce(`“${input}” isn't a supported command. See the command guide below.`, "error");
    });
  }, [addTask, announce, completedCount, csv, pendingCount, runWorkflow]);

  const handleSubmit = (event) => {
    event.preventDefault();
    processCommand(command);
  };

  const handleFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setCsvError("");
    setNotice(null);
    setCsv(null);
    setResultPanel("csv");
    if (!/\.csv$/i.test(file.name) && file.type !== "text/csv") {
      setCsvError("Choose a .csv file to analyze.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setCsvError("This file is larger than 10 MB. Choose a smaller CSV.");
      return;
    }
    try {
      const parsed = parseCsv(await file.text());
      setCsv({ ...parsed, fileName: file.name, fileSize: file.size });
      announce(`${file.name} is ready. Your data stayed in this browser.`);
    } catch (error) {
      setCsvError(error instanceof Error ? error.message : "The CSV could not be read.");
    }
  };

  const toggleTask = (id) => {
    setTasks((current) => current.map((task) => task.id === id ? { ...task, completed: !task.completed } : task));
  };

  const deleteTask = (id) => {
    setTasks((current) => current.filter((task) => task.id !== id));
    announce("Task removed.");
  };

  const startListening = () => {
    const Recognition = getSpeechRecognition();
    if (!Recognition) {
      announce("Speech input isn't supported in this browser. Type a command instead.", "error");
      return;
    }
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }
    const recognition = new Recognition();
    recognitionRef.current = recognition;
    recognition.lang = navigator.language || "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => setIsListening(true);
    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript;
      if (transcript) {
        setCommand(transcript);
        announce("Voice captured. Press Enter to run the command.");
      } else {
        announce("No speech was detected. Please try again or type a command.", "error");
      }
    };
    recognition.onerror = (event) => {
      setIsListening(false);
      announce(event.error === "not-allowed"
        ? "Microphone access was denied. Allow access in your browser settings or type a command."
        : `Voice input failed (${event.error}). You can still type a command.`, "error");
    };
    recognition.onend = () => setIsListening(false);
    try {
      recognition.start();
    } catch {
      setIsListening(false);
      announce("Voice input couldn't start. You can still type a command.", "error");
    }
  };

  const runExample = (example) => {
    setCommand(example);
    processCommand(example);
  };

  const hour = clock.getHours();
  const greetingText = greeting || (hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening");
  const clockText = clock.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  const dateText = clock.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
  const maxChartValue = csv?.numericColumns?.[0]
    ? Math.max(...csv.numericColumns[0].values.map((value) => Math.abs(value)), 1)
    : 1;

  return (
    <main className="app-shell">
      <div className="ambient ambient-one" aria-hidden="true" />
      <div className="ambient ambient-two" aria-hidden="true" />
      <div className="grid-overlay" aria-hidden="true" />

      <header className="topbar">
        <a className="brand" href="#" aria-label="ODIN Command Center home" onClick={() => { setResultPanel("welcome"); setNotice(null); }}>
          <span className="brand-mark"><Icon name="command" size={22} /></span>
          <span className="brand-word">ODIN<span className="brand-separator">/</span><span className="brand-sub">COMMAND CENTER</span></span>
        </a>
        <div className="topbar-right">
          <div className="system-pill"><span className={`status-dot ${isOnline ? "" : "offline"}`} />{isOnline ? "ALL SYSTEMS NOMINAL" : "OFFLINE MODE"}</div>
          <span className="topbar-divider" />
          <div className="clock-block"><span>{clockText}</span><small>{dateText}</small></div>
          <div className="avatar" aria-label="Local user">O</div>
        </div>
      </header>

      <div className="layout">
        <aside className="sidebar">
          <div className="side-label">WORKSPACE</div>
          <nav aria-label="Workspace sections">
            <button className={`nav-item ${resultPanel === "welcome" ? "active" : ""}`} onClick={() => { setResultPanel("welcome"); setNotice(null); }}>
              <span className="nav-icon"><Icon name="command" /></span>Overview <span className="nav-active-mark" />
            </button>
            <button className={`nav-item ${resultPanel === "tasks" ? "active" : ""}`} onClick={() => setResultPanel("tasks")}>
              <span className="nav-icon"><Icon name="check" /></span>Tasks <span className="nav-count">{pendingCount}</span>
            </button>
            <button className={`nav-item ${resultPanel === "csv" ? "active" : ""}`} onClick={() => { setResultPanel("csv"); fileInputRef.current?.focus(); }}>
              <span className="nav-icon"><Icon name="chart" /></span>Data lab
            </button>
          </nav>
          <div className="side-bottom">
            <div className="sidebar-status">
              <div className="side-label">LOCAL ENVIRONMENT</div>
              <div className="sidebar-status-row"><span className={`status-dot ${storageAvailable ? "" : "offline"}`} />Storage {storageAvailable ? "available" : "unavailable"}</div>
              <div className="sidebar-status-row"><span className={`status-dot ${speechSupported ? "" : "muted"}`} />Voice {speechSupported ? "ready" : "not supported"}</div>
              <div className="privacy-note"><span className="privacy-lock">◆</span> Your data stays on this device.</div>
            </div>
            <div className="version-label">ODIN CORE <span>V1.0.0</span></div>
          </div>
        </aside>

        <section className="main-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow"><span className="eyebrow-line" />PERSONAL OPERATIONS INTERFACE</div>
              <h1>{resultPanel === "welcome" ? <>Your command.<br /><span>Your momentum.</span></> : resultPanel === "tasks" ? <>Task <span>board.</span></> : resultPanel === "csv" ? <>Data <span>lab.</span></> : resultPanel === "status" ? <>System <span>status.</span></> : resultPanel === "help" ? <>Command <span>guide.</span></> : <>Welcome <span>back.</span></>}</h1>
              <p className="heading-description">{resultPanel === "welcome" ? `${greetingText}. What would you like to get done?` : resultPanel === "tasks" ? "Small steps. Clear priorities. Keep moving forward." : resultPanel === "csv" ? "Explore your data with fast, private, on-device analysis." : resultPanel === "status" ? "A live readout of the capabilities available in this browser." : resultPanel === "help" ? "ODIN runs a focused set of reliable commands—no AI guesswork." : `${greetingText}. Your workspace is ready.`}</p>
            </div>
            <div className="hero-ornament" aria-hidden="true"><div className="orbit orbit-outer" /><div className="orbit orbit-inner" /><div className="orbit-core"><Icon name="command" size={28} /></div><span className="orbit-label">ODIN / 01</span></div>
          </div>

          <section className="command-card" aria-label="Command input">
            <div className="command-card-top">
              <div className="command-label"><span className="command-prompt">⌘</span>COMMAND LINE <span className="command-mode">NATURAL LANGUAGE</span></div>
              <span className="command-shortcut">ENTER <span>↵</span></span>
            </div>
            <form className="command-form" onSubmit={handleSubmit}>
              <label className="sr-only" htmlFor="command-input">Enter a supported command</label>
              <span className="input-prefix">&gt;</span>
              <input
                id="command-input"
                ref={commandInputRef}
                value={command}
                onChange={(event) => setCommand(event.target.value)}
                placeholder="Try “show my tasks” or “create a task to…”"
                autoComplete="off"
                aria-describedby="command-hint"
              />
              <button className={`mic-button ${isListening ? "listening" : ""}`} type="button" onClick={startListening} aria-label={isListening ? "Stop voice input" : speechSupported ? "Start voice input" : "Voice input not supported"} title={speechSupported ? "Voice input" : "Voice input isn't supported by this browser"}>
                {isListening ? <span className="listening-pulse" /> : <Icon name="mic" size={18} />}
              </button>
              <button className="run-button" type="submit" aria-label="Run command"><span>Run command</span><Icon name="arrow" size={17} /></button>
            </form>
            <div className="command-card-bottom">
              <span id="command-hint">Commands are matched locally. Type <kbd>help</kbd> to see what’s supported.</span>
              <span className="secure-label"><span />LOCAL &amp; PRIVATE</span>
            </div>
          </section>

          {notice && (
            <div className={`notice ${notice.kind}`} role="status" aria-live="polite">
              <span className="notice-icon">{notice.kind === "error" ? "!" : "✓"}</span>{notice.message}
              <button type="button" className="notice-close" onClick={() => setNotice(null)} aria-label="Dismiss message"><Icon name="close" size={16} /></button>
            </div>
          )}

          {workflow && (
            <section className="workflow-card" aria-live="polite" aria-label="Command progress">
              <div className="workflow-head"><span className="workflow-spinner" /><div><strong>{workflow.title}</strong><small>{workflow.steps[Math.min(workflow.step, workflow.steps.length - 1)]}…</small></div><span className="workflow-percent">{Math.round(workflow.step / workflow.steps.length * 100)}%</span></div>
              <div className="progress-track"><span style={{ width: `${workflow.step / workflow.steps.length * 100}%` }} /></div>
            </section>
          )}

          <div className="workspace-grid">
            <div className="primary-column">
              {resultPanel === "welcome" && (
                <section className="welcome-panel">
                  <div className="section-heading"><div><span className="section-kicker">QUICK START</span><h2>One command away.</h2></div><span className="section-index">01 / 03</span></div>
                  <p className="section-copy">Pick a command to see ODIN in action. Each one runs locally, right here in your browser.</p>
                  <div className="example-list">
                    {EXAMPLES.map((example, index) => (
                      <button key={example} className="example-button" onClick={() => runExample(example)}>
                        <span className="example-number">0{index + 1}</span><span>{example}</span><Icon name="arrow" size={16} />
                      </button>
                    ))}
                  </div>
                  <div className="welcome-foot"><span className="spark-icon"><Icon name="spark" size={15} /></span>Focused commands. No AI guesswork. Always in your control.</div>
                </section>
              )}

              {resultPanel === "tasks" && (
                <section className="panel">
                  <div className="section-heading"><div><span className="section-kicker">YOUR WORKSPACE</span><h2>Things in motion.</h2></div><span className="section-index">{pendingCount} OPEN</span></div>
                  <div className="task-summary"><div><strong>{pendingCount.toString().padStart(2, "0")}</strong><span>OPEN</span></div><div><strong>{completedCount.toString().padStart(2, "0")}</strong><span>COMPLETED</span></div><button onClick={() => commandInputRef.current?.focus()}>+ Add via command</button></div>
                  {tasks.length === 0 ? (
                    <div className="empty-state"><div className="empty-icon"><Icon name="check" size={23} /></div><strong>A clear runway.</strong><p>No tasks yet. Try <button className="inline-command" onClick={() => { setCommand("Create a task to "); commandInputRef.current?.focus(); }}>creating your first task</button> from the command line.</p></div>
                  ) : (
                    <ul className="task-list">
                      {tasks.map((task) => (
                        <li className={`task-item ${task.completed ? "completed" : ""}`} key={task.id}>
                          <button className="task-check" onClick={() => toggleTask(task.id)} aria-label={task.completed ? `Mark ${task.title} incomplete` : `Complete ${task.title}`} aria-pressed={task.completed}>{task.completed && <Icon name="check" size={14} />}</button>
                          <span className="task-title">{task.title}</span>
                          <span className="task-date">{new Date(task.createdAt || Date.now()).toLocaleDateString([], { month: "short", day: "numeric" })}</span>
                          <button className="task-delete" onClick={() => deleteTask(task.id)} aria-label={`Delete ${task.title}`}><Icon name="trash" size={16} /></button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="storage-foot"><span className={`status-dot ${storageAvailable ? "" : "offline"}`} />{storageAvailable ? "Saved automatically on this device" : "Browser storage unavailable — changes may not persist"}</div>
                </section>
              )}

              {resultPanel === "csv" && (
                <section className="panel">
                  <div className="section-heading"><div><span className="section-kicker">PRIVATE BY DESIGN</span><h2>Read the numbers.</h2></div><span className="section-index">ON-DEVICE</span></div>
                  <p className="section-copy">Upload a CSV to get instant row counts, numeric summaries, and a quick visual. Your file never leaves this device.</p>
                  <input ref={fileInputRef} className="sr-only" id="csv-upload" type="file" accept=".csv,text/csv" onChange={handleFile} aria-label="Choose a CSV file" />
                  <label className={`upload-zone ${csv ? "has-file" : ""}`} htmlFor="csv-upload" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); fileInputRef.current?.click(); } }}>
                    <span className="upload-icon"><Icon name="upload" size={21} /></span><span className="upload-text"><strong>{csv ? csv.fileName : "Choose a CSV file"}</strong><small>{csv ? `${(csv.fileSize / 1024).toFixed(1)} KB · ready to analyze` : "Drag-free, private, and instant · max 10 MB"}</small></span><span className="upload-action">{csv ? "Replace" : "Browse"} <Icon name="arrow" size={15} /></span>
                  </label>
                  {csvError && <div className="csv-error" role="alert"><span>!</span>{csvError}</div>}
                  {!csv && !csvError && <div className="csv-empty"><span className="csv-empty-symbol">↳</span> Your analysis will appear here after upload.</div>}
                  {csv && (
                    <div className="analysis-result">
                      <div className="analysis-stats"><div><strong>{csv.rowCount.toLocaleString()}</strong><span>DATA ROWS</span></div><div><strong>{csv.headers.length}</strong><span>COLUMNS</span></div><div><strong>{csv.numericColumns.length}</strong><span>NUMERIC</span></div></div>
                      {csv.numericColumns.length > 0 ? (
                        <>
                          <div className="chart-title"><span>QUICK PLOT</span><strong>{csv.numericColumns[0].name}</strong></div>
                          <div className="bar-chart" role="img" aria-label={`Bar chart showing first ${csv.numericColumns[0].values.length} values in ${csv.numericColumns[0].name}`}>
                            {csv.numericColumns[0].values.map((value, index) => (
                              <div className="chart-column" key={`${index}-${value}`} title={`${csv.numericColumns[0].name}: ${value}`}>
                                <span className="chart-value">{Number(value.toPrecision(4))}</span><div className="chart-bar-track"><span style={{ height: `${Math.max(7, Math.abs(value) / maxChartValue * 100)}%` }} /></div><small>{index + 1}</small>
                              </div>
                            ))}
                          </div>
                          <div className="numeric-summary"><span>AVG <strong>{csv.numericColumns[0].average.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong></span><span>MIN <strong>{csv.numericColumns[0].minimum.toLocaleString()}</strong></span><span>MAX <strong>{csv.numericColumns[0].maximum.toLocaleString()}</strong></span></div>
                        </>
                      ) : (
                        <div className="csv-empty no-numeric">No numeric columns found. Row and column totals are ready; add numeric values for a chart.</div>
                      )}
                    </div>
                  )}
                  {csv && <button className="text-button clear-file" onClick={() => { setCsv(null); setCsvError(""); announce("CSV cleared from this session."); }}>Clear uploaded data <Icon name="close" size={15} /></button>}
                </section>
              )}

              {resultPanel === "status" && (
                <section className="panel">
                  <div className="section-heading"><div><span className="section-kicker">LIVE DIAGNOSTICS</span><h2>Ready when you are.</h2></div><span className="section-index">LIVE</span></div>
                  <div className="diagnostics-list">
                    <div className="diagnostic-row"><span className={`status-dot ${isOnline ? "" : "offline"}`} /><span><strong>Network connection</strong><small>Browser online status</small></span><b>{isOnline ? "ONLINE" : "OFFLINE"}</b></div>
                    <div className="diagnostic-row"><span className={`status-dot ${storageAvailable ? "" : "offline"}`} /><span><strong>Local task storage</strong><small>Tasks persist on this device</small></span><b>{storageAvailable ? "AVAILABLE" : "UNAVAILABLE"}</b></div>
                    <div className="diagnostic-row"><span className={`status-dot ${speechSupported ? "" : "muted"}`} /><span><strong>Speech recognition</strong><small>{speechSupported ? "Browser voice input detected" : "Use text input in this browser"}</small></span><b>{speechSupported ? "SUPPORTED" : "UNAVAILABLE"}</b></div>
                    <div className="diagnostic-row"><span className="status-dot" /><span><strong>CSV analysis</strong><small>Private JavaScript processing</small></span><b>READY</b></div>
                    <div className="diagnostic-row"><span className="status-dot" /><span><strong>Secure context</strong><small>{window.isSecureContext ? "Browser secure context" : "Local browser context"}</small></span><b>{window.isSecureContext ? "SECURE" : "LOCAL"}</b></div>
                  </div>
                  <div className="diagnostics-foot">SYSTEM CHECK COMPLETED AT {clockText}</div>
                </section>
              )}

              {resultPanel === "help" && (
                <section className="panel">
                  <div className="section-heading"><div><span className="section-kicker">SUPPORTED COMMANDS</span><h2>Clear inputs. Useful outputs.</h2></div><span className="section-index">5 COMMANDS</span></div>
                  <p className="section-copy">ODIN uses a simple local command parser. If a request does not match a supported command, it will tell you.</p>
                  <div className="help-list">
                    {EXAMPLES.map((example) => <button key={example} className="help-command" onClick={() => runExample(example)}><code>{example}</code><Icon name="arrow" size={16} /></button>)}
                  </div>
                  <div className="help-note"><span className="spark-icon"><Icon name="spark" size={15} /></span> No external AI or backend is used. Commands and file analysis run in your browser.</div>
                </section>
              )}
            </div>

            <aside className="right-column">
              <section className="metric-card">
                <div className="metric-top"><span>TASK SNAPSHOT</span><span className="metric-live"><i />LIVE</span></div>
                <div className="metric-number">{pendingCount.toString().padStart(2, "0")}<span> / {tasks.length.toString().padStart(2, "0")}</span></div>
                <div className="metric-caption">OPEN TASKS</div>
                <div className="metric-divider" />
                <div className="metric-progress-head"><span>Completion</span><strong>{tasks.length ? Math.round(completedCount / tasks.length * 100) : 0}%</strong></div>
                <div className="metric-progress"><span style={{ width: `${tasks.length ? completedCount / tasks.length * 100 : 0}%` }} /></div>
                <button className="metric-link" onClick={() => setResultPanel("tasks")}>View task board <Icon name="arrow" size={15} /></button>
              </section>

              <section className="mini-status">
                <div className="mini-status-heading"><span className="section-kicker">SYSTEM PULSE</span><span className={`pulse-indicator ${isOnline ? "" : "offline"}`}><i /></span></div>
                <div className="pulse-wave" aria-hidden="true"><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /></div>
                <div className="pulse-caption"><span>NETWORK SIGNAL</span><strong className={isOnline ? "" : "offline"}>{isOnline ? "ONLINE" : "OFFLINE"}</strong></div>
              </section>

              <section className="privacy-card"><span className="privacy-emblem">◇</span><div><strong>Your space, your data.</strong><p>Tasks live in local storage. CSV files are analyzed in memory and never uploaded.</p></div></section>

              <div className="right-footer"><span>BUILT FOR FOCUS</span><span>01 — ODIN</span></div>
            </aside>
          </div>
          <footer className="mobile-footer"><span>ODIN CORE / V1.0.0</span><span>LOCAL BY DESIGN ◇</span></footer>
        </section>
      </div>
    </main>
  );
}

export default App;
