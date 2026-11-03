const sonarjs = require("eslint-plugin-sonarjs");

module.exports = [
	{
		files: ["js/**/*.js"],
		plugins: { sonarjs },
		rules: {
			...sonarjs.configs.recommended.rules,
		},
	},
	{
		ignores: ["node_modules/**"],
	},
];
