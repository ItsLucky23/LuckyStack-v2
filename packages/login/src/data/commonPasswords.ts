//? Built-in common-password blocklist. Sourced from the public-domain
//? SecLists Top-passwords list (Daniel Miessler), trimmed to the 200 most
//? common entries to keep the package size small. Consumers needing a
//? larger list (10k+ entries) can supply one through
//? `projectConfig.auth.passwordPolicy.customValidator` and check their
//? own data source there.
//?
//? Lookups are case-insensitive (the validator lower-cases before
//? checking). Adding additional entries here is a non-breaking change.

const COMMON_PASSWORD_LIST: readonly string[] = [
  '123456', 'password', '12345678', 'qwerty', '123456789', '12345', '1234', '111111',
  '1234567', 'dragon', '123123', 'baseball', 'abc123', 'football', 'monkey', 'letmein',
  '696969', 'shadow', 'master', '666666', 'qwertyuiop', '123321', 'mustang', '1234567890',
  'michael', '654321', 'pussy', 'superman', '1qaz2wsx', '7777777', 'fuckyou', '121212',
  '000000', 'qazwsx', '123qwe', 'killer', 'trustno1', 'jordan', 'jennifer', 'zxcvbnm',
  'asdfgh', 'hunter', 'buster', 'soccer', 'harley', 'batman', 'andrew', 'tigger',
  'sunshine', 'iloveyou', 'fuckme', '2000', 'charlie', 'robert', 'thomas', 'hockey',
  'ranger', 'daniel', 'starwars', 'klaster', '112233', 'george', 'asshole', 'computer',
  'michelle', 'jessica', 'pepper', '1111', 'zxcvbn', '555555', '11111111', '131313',
  'freedom', '777777', 'pass', 'fuck', 'maggie', '159753', 'aaaaaa', 'ginger',
  'princess', 'joshua', 'cheese', 'amanda', 'summer', 'love', 'ashley', '6969',
  'nicole', 'chelsea', 'biteme', 'matthew', 'access', 'yankees', '987654321', 'dallas',
  'austin', 'thunder', 'taylor', 'matrix', 'william', 'corvette', 'hello', 'martin',
  'heather', 'secret', 'fucker', 'merlin', 'diamond', '1234qwer', 'gfhjkm', 'hammer',
  'silver', 'richard', 'samantha', 'iceman', 'tigers', 'purple', 'andrea', 'horney',
  'dakota', 'aaaaa', 'player', 'sucker', 'mercedes', 'whatever', 'orange', 'qweqwe',
  'mickey', 'panties', 'hannah', 'fucking', 'paul', 'pakistan', 'patrick', 'martha',
  'morgan', 'iwantu', 'lakers', 'rachel', 'slayer', 'scott', '2112', 'fish',
  'porn', 'matt', 'qwert', 'cookie', 'eagle1', 'london', 'phoenix', 'chicago',
  'badboy', 'braves', 'yankee', 'lover', 'barney', 'edward', 'raiders', 'green',
  'maverick', 'rangers', 'joseph', 'maddog', 'mike', 'jasmine', 'arsenal', 'beach',
  'tiger', 'snoopy', 'natasha', 'matthews', 'jackson', 'cumshot', 'chevy', 'gateway',
  'gators', 'angel', 'junior', 'samson', '6666', 'amateur', 'gemini', 'apples',
  'august', 'biscuit', '5150', 'apollo', 'parker', 'qwerty123', 'rabbit', 'angela',
  'love123', 'rocket', 'scooby', 'beaver', 'oliver', 'walter', 'blowme', 'spider',
  '4321', 'cumshot1', 'lucky', 'helpme', 'jackie', 'monica',
];

/** Frozen Set for O(1) `.has()` lookups; entries are pre-lowercased. */
export const COMMON_PASSWORDS: ReadonlySet<string> = new Set(
  COMMON_PASSWORD_LIST.map((p) => p.toLowerCase()),
);
