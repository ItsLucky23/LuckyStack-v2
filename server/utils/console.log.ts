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

export const initConsolelog = () => {
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    const stack = new Error('console.log trace').stack?.split("\n")[2]?.trim();
    if (!stack) { originalLog(...args); return; }
  
    let lineInfo = stack.slice(stack.indexOf("(") + 1, stack.lastIndexOf(")"));
    if (lineInfo === "") lineInfo = stack;
    const extractedInfo = lineInfo
      .slice(Math.max(0, lineInfo.lastIndexOf("\\") + 1))
      .replace(/:\d+$/, "");
  
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