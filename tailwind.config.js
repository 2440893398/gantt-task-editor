/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                primary: "#4A90E2",
                "primary-hover": "#3a7bc8", // Custom color to match old variables if needed, or stick to daisyui primary
            }
        },
    },
    plugins: [
        require('daisyui'),
    ],
    daisyui: {
        themes: [
            {
                light: {
                    ...require("daisyui/src/theming/themes")["light"],
                    primary: "#4A90E2",
                    secondary: "#6B7280",
                    accent: "#50E3C2",
                    "base-100": "#ffffff",
                    "base-200": "#F9FAFB",
                },
            },
        ],
    },
}
