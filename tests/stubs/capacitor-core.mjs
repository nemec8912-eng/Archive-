export const Capacitor = {
  isNativePlatform: () => globalThis.__native === true,
  getPlatform: () => 'android',
  convertFileSrc: (uri) => uri, // mem://… — fetch не сработает, проверяется запасной путь через readFile
};
