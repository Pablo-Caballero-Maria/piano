/**
 * Prettier: the TypeScript/CSS formatting (the Python side uses ruff format, line length 110), with
 * Tailwind's classes in its recommended order (prettier-plugin-tailwindcss, from globals.css's theme).
 */
const config = {
  printWidth: 110,
  plugins: ["prettier-plugin-tailwindcss"],
  tailwindStylesheet: "./src/app/globals.css",
};

export default config;
