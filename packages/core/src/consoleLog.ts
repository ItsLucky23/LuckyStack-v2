const COLORS: Record<string, string> = {
  black: "\u001B[30m",
  red: "\u001B[31m",
  green: "\u001B[32m",
  yellow: "\u001B[33m",
  blue: "\u001B[34m",
  magenta: "\u001B[35m",
  cyan: "\u001B[36m",
  white: "\u001B[37m",
  reset: "\u001B[0m",
};

//? Strip both POSIX `/` and Windows `\` separators so the file:line tag is
//? consistent across platforms. Drop the column suffix too — `:42:7` becomes
//? `:42`. If the regex finds no separator at all, fall back to the bare
//? string (avoids leaking the full filesystem path).
const FILE_NAME_REGEX = /[\\/]([^\\/]+)$/;

const extractFrameLabel = (frame: string): string => {
  let lineInfo = frame.slice(frame.indexOf("(") + 1, frame.lastIndexOf(")"));
  if (lineInfo === "") lineInfo = frame;
  const match = FILE_NAME_REGEX.exec(lineInfo);
  const fileName = match ? match[1] : lineInfo;
  return fileName.replace(/:\d+(?::\d+)?$/, "");
};

export const initConsolelog = () => {
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    const stackLines = new Error('console.log trace').stack?.split("\n") ?? [];
    //? Search for the first frame outside this module so wrapper functions
    //? (e.g. `getLogger().info` → `console.log`) don't pin the label to the
    //? wrapper. Frame 0 is the Error itself; skip it.
    const frame = stackLines.slice(1).find((line) => {
      const trimmed = line.trim();
      return trimmed.length > 0 && !trimmed.includes('consoleLog.ts') && !trimmed.includes('loggerRegistry.ts');
    })?.trim();

    if (!frame) { originalLog(...args); return; }

    const extractedInfo = extractFrameLabel(frame);

    // find color keyword and remove it from args
    let colorCode = COLORS.white;
    for (const key of Object.keys(COLORS)) {
      const index = args.indexOf(key);
      if (index !== -1) {
        colorCode = COLORS[key];
        args.splice(index, 1);
        break;
      }
    }

    // handle object vs text
    if (typeof args[0] === "object") {
      originalLog(`${colorCode}${extractedInfo}${COLORS.reset}`);
      originalLog(...args);
    } else {
      originalLog(`${colorCode}${extractedInfo} -- ${args.join(" ")}${COLORS.reset}`);
    }
  };
}