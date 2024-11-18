const { defineConfig } = require('cypress');

module.exports = defineConfig({
	defaultCommandTimeout: 15000, // Sets the default command timeout
	video: false, // Disables video recording
	projectId: '99zfrs', // Your Cypress Dashboard project ID
	e2e: {
		// eslint-disable-next-line no-unused-vars
		setupNodeEvents(on, config) {
			// You can define Node event listeners here if needed
		},
		specPattern: 'cypress/**/*.{js,jsx,ts,tsx}', // Default location for spec files
		supportFile: 'cypress/support/index.js',
	},
});
