import { Meteor } from 'meteor/meteor';
import { Accounts } from 'meteor/accounts-base';
import _ from 'underscore';
import colors from 'colors/safe';

import { RocketChatFile } from '../../app/file';
import { FileUpload } from '../../app/file-upload';
import { addUserRoles, getUsersInRole } from '../../app/authorization';
import { Users, Settings, Rooms } from '../../app/models';
import { settings } from '../../app/settings';
import { checkUsernameAvailability, addUserToDefaultChannels } from '../../app/lib';

Meteor.startup(function() {
	Meteor.defer(() => {
		if (!Rooms.findOneById('GENERAL')) {
			Rooms.createWithIdTypeAndName('GENERAL', 'c', 'general', {
				default: true,
			});
		}

		if (!Users.findOneById('rocket.cat')) {
			Users.create({
				_id: 'rocket.cat',
				name: 'Rocket.Cat',
				username: 'rocket.cat',
				status: 'online',
				statusDefault: 'online',
				utcOffset: 0,
				active: true,
				type: 'bot',
			});

			addUserRoles('rocket.cat', 'bot');

			const buffer = Buffer.from(Assets.getBinary('avatars/rocketcat.png'));

			const rs = RocketChatFile.bufferToStream(buffer, 'utf8');
			const fileStore = FileUpload.getStore('Avatars');
			fileStore.deleteByName('rocket.cat');

			const file = {
				userId: 'rocket.cat',
				type: 'image/png',
				size: buffer.length,
			};

			Meteor.runAsUser('rocket.cat', () => {
				fileStore.insert(file, rs, () => Users.setAvatarData('rocket.cat', 'local', null));
			});
		}

		if (process.env.ADMIN_PASS) {
			if (_.isEmpty(getUsersInRole('admin').fetch())) {
				console.log('Inserting admin user:'.green);
				const adminUser = {
					name: 'Administrator',
					username: 'admin',
					status: 'offline',
					statusDefault: 'online',
					utcOffset: 0,
					active: true,
				};

				if (process.env.ADMIN_NAME) {
					adminUser.name = process.env.ADMIN_NAME;
				}

				console.log(colors.green(`Name: ${ adminUser.name }`));

				if (process.env.ADMIN_EMAIL) {
					const re = /^[^@].*@[^@]+$/i;

					if (re.test(process.env.ADMIN_EMAIL)) {
						if (!Users.findOneByEmailAddress(process.env.ADMIN_EMAIL)) {
							adminUser.emails = [{
								address: process.env.ADMIN_EMAIL,
								verified: process.env.ADMIN_EMAIL_VERIFIED === 'true',
							}];

							console.log(olors.green(`Email: ${ process.env.ADMIN_EMAIL }`));
						} else {
							console.log(colors.red('Email provided already exists; Ignoring environment variables ADMIN_EMAIL'));
						}
					} else {
						console.log(colors.red('Email provided is invalid; Ignoring environment variables ADMIN_EMAIL'));
					}
				}

				if (process.env.ADMIN_USERNAME) {
					let nameValidation;

					try {
						nameValidation = new RegExp(`^${ settings.get('UTF8_Names_Validation') }$`);
					} catch (error) {
						nameValidation = new RegExp('^[0-9a-zA-Z-_.]+$');
					}

					if (nameValidation.test(process.env.ADMIN_USERNAME)) {
						if (checkUsernameAvailability(process.env.ADMIN_USERNAME)) {
							adminUser.username = process.env.ADMIN_USERNAME;
						} else {
							console.log(colors.red('Username provided already exists; Ignoring environment variables ADMIN_USERNAME'));
						}
					} else {
						console.log(colors.red('Username provided is invalid; Ignoring environment variables ADMIN_USERNAME'));
					}
				}

				console.log(colors.green(`Username: ${ adminUser.username }`));

				adminUser.type = 'user';

				const id = Users.create(adminUser);

				Accounts.setPassword(id, process.env.ADMIN_PASS);

				addUserRoles(id, 'admin');
			} else {
				console.log(colors.red('Users with admin role already exist; Ignoring environment variables ADMIN_PASS'));
			}
		}

		if (typeof process.env.INITIAL_USER === 'string' && process.env.INITIAL_USER.length > 0) {
			try {
				const initialUser = JSON.parse(process.env.INITIAL_USER);

				if (!initialUser._id) {
					console.log(colors.red('No _id provided; Ignoring environment variable INITIAL_USER'));
				} else if (!Users.findOneById(initialUser._id)) {
					console.log(colors.green('Inserting initial user:'));
					console.log(colors.green(JSON.stringify(initialUser, null, 2)));
					Users.create(initialUser);
				}
			} catch (e) {
				console.log(colors.red('Error processing environment variable INITIAL_USER'), e);
			}
		}

		if (_.isEmpty(getUsersInRole('admin').fetch())) {
			const oldestUser = Users.getOldest({ _id: 1, username: 1, name: 1 });

			if (oldestUser) {
				addUserRoles(oldestUser._id, 'admin');
				console.log(`No admins are found. Set ${ oldestUser.username || oldestUser.name } as admin for being the oldest user`);
			}
		}

		if (!_.isEmpty(getUsersInRole('admin').fetch())) {
			if (settings.get('Show_Setup_Wizard') === 'pending') {
				console.log('Setting Setup Wizard to "in_progress" because, at least, one admin was found');
				Settings.updateValueById('Show_Setup_Wizard', 'in_progress');
			}
		}

		Users.removeById('rocketchat.internal.admin.test');

		if (process.env.TEST_MODE === 'true') {
			console.log(colors.green('Inserting admin test user:'));

			const adminUser = {
				_id: 'rocketchat.internal.admin.test',
				name: 'RocketChat Internal Admin Test',
				username: 'rocketchat.internal.admin.test',
				emails: [
					{
						address: 'rocketchat.internal.admin.test@rocket.chat',
						verified: false,
					},
				],
				status: 'offline',
				statusDefault: 'online',
				utcOffset: 0,
				active: true,
				type: 'user',
			};

			console.log(colors.green(`Name: ${ adminUser.name }`));
			console.log(colors.green(`Email: ${ adminUser.emails[0].address }`));
			console.log(colors.green(`Username: ${ adminUser.username }`));
			console.log(colors.green(`Password: ${ adminUser._id }`));

			if (Users.findOneByEmailAddress(adminUser.emails[0].address)) {
				throw new Meteor.Error(`Email ${ adminUser.emails[0].address } already exists`, 'Rocket.Chat can\'t run in test mode');
			}

			if (!checkUsernameAvailability(adminUser.username)) {
				throw new Meteor.Error(`Username ${ adminUser.username } already exists`, 'Rocket.Chat can\'t run in test mode');
			}

			Users.create(adminUser);

			Accounts.setPassword(adminUser._id, adminUser._id);

			addUserRoles(adminUser._id, 'admin');

			if (settings.get('Show_Setup_Wizard') === 'pending') {
				Settings.updateValueById('Show_Setup_Wizard', 'in_progress');
			}

			return addUserToDefaultChannels(adminUser, true);
		}
	});
});
