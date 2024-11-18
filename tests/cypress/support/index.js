// Import commands.js using ES2015 syntax:
import './commands';

// Example of using `cy.session()` for preserving cookies
Cypress.Commands.add('preserveCookies', () => {
	cy.session('userSession', () => {
		// Replace these with actions that log in or restore the session
		cy.setCookie('rc_uid', 'some-value');
		cy.setCookie('rc_token', 'some-value');
	});
});

// Use this command in your tests to ensure cookies are preserved
Cypress.on('uncaught:exception', () =>
// Prevent Cypress from failing the test on uncaught exceptions
	false,
);

Cypress.LocalStorage.clear = function() {};

// Optional: Custom failure handling (not recommended in most cases)
Cypress.on('fail', (error) => {
	Cypress.stop();
	throw error;
});
