import { Meteor } from 'meteor/meteor';
import { TAPi18n } from 'meteor/rocketchat:tap-i18n';

import { Messages, EmojiCustom, Rooms } from '../../models';
import { callbacks } from '../../callbacks';
import { emoji } from '../../emoji';
import { isTheLastMessage, msgStream } from '../../lib';
import { hasPermission } from '../../authorization/server/functions/hasPermission';
import { api } from '../../../server/sdk/api';

// Helper to get users count (handles both array and object formats)
const getUsersCount = (message, reaction) => {
	if (!message.reactions || !message.reactions[reaction]) {
		return 0;
	}
	const users = message.reactions[reaction].users;
	if (!users) {
		return 0;
	}
	// Handle both array (legacy) and object (new) formats
	if (Array.isArray(users)) {
		return users.length;
	}
	return Object.keys(users).length;
};

// Helper to check if reaction emoji has any users left
const isReactionEmpty = (message, reaction) => {
	return getUsersCount(message, reaction) === 0;
};

// Helper to check if user already reacted
const hasUserReacted = (message, reaction, username) => {
	if (!message.reactions || !message.reactions[reaction]) {
		return false;
	}
	const usernames = message.reactions[reaction].usernames;
	return usernames && usernames.indexOf(username) !== -1;
};

// Helper to check if all reactions are empty
const areAllReactionsEmpty = (message) => {
	if (!message.reactions) {
		return true;
	}
	return Object.keys(message.reactions).every((reaction) => isReactionEmpty(message, reaction));
};

async function setReaction(room, user, message, reaction, shouldReact) {
	reaction = `:${ reaction.replace(/:/g, '') }:`;

	if (!emoji.list[reaction] && EmojiCustom.findByNameOrAlias(reaction).count() === 0) {
		throw new Meteor.Error('error-not-allowed', 'Invalid emoji provided.', { method: 'setReaction' });
	}

	if (room.ro === true && (!room.reactWhenReadOnly && !hasPermission(user._id, 'post-readonly', room._id))) {
		// Unless the user was manually unmuted
		if (!(room.unmuted || []).includes(user.username)) {
			throw new Error('You can\'t send messages because the room is readonly.');
		}
	}

	if (Array.isArray(room.muted) && room.muted.indexOf(user.username) !== -1) {
		throw new Meteor.Error('error-not-allowed', TAPi18n.__('You_have_been_muted', {}, user.language), {
			rid: room._id,
		});
	}

	const userAlreadyReacted = hasUserReacted(message, reaction, user.username);
	// When shouldReact was not informed, toggle the reaction.
	if (shouldReact === undefined) {
		shouldReact = !userAlreadyReacted;
	}

	if (userAlreadyReacted === shouldReact) {
		return;
	}

	// Prepare user object for storing in reactions.users
	const reactor = {
		_id: user._id,
		username: user.username,
		name: user.name,
	};

	if (userAlreadyReacted) {
		// REMOVE reaction - atomic operation
		Messages.removeReaction(message._id, reaction, user.username, user._id);

		// Re-fetch message to check if reaction emoji is now empty
		const updatedMessage = Messages.findOneById(message._id);

		if (isReactionEmpty(updatedMessage, reaction)) {
			// Remove the entire reaction emoji if no users left
			Messages.removeReactionEmoji(message._id, reaction);
		}

		// Re-fetch to check if all reactions are empty
		const finalMessage = Messages.findOneById(message._id);

		if (areAllReactionsEmpty(finalMessage)) {
			Messages.unsetReactions(message._id);
			if (isTheLastMessage(room, finalMessage)) {
				Rooms.unsetReactionsInLastMessage(room._id);
			}
		} else if (isTheLastMessage(room, finalMessage)) {
			Rooms.setReactionsInLastMessage(room._id, finalMessage);
		}

		callbacks.run('unsetReaction', message._id, reaction);
		callbacks.run('afterUnsetReaction', finalMessage, { user, reaction, shouldReact });

		// Update message reference for msgStream
		message = finalMessage;
	} else {
		// ADD reaction - atomic operation
		Messages.addReaction(message._id, reaction, user.username, reactor);

		// Re-fetch message for callbacks and lastMessage update
		const updatedMessage = Messages.findOneById(message._id);

		if (isTheLastMessage(room, updatedMessage)) {
			Rooms.setReactionsInLastMessage(room._id, updatedMessage);
		}

		callbacks.run('setReaction', message._id, reaction);
		callbacks.run('afterSetReaction', updatedMessage, { user, reaction, shouldReact });

		// Update message reference for msgStream
		message = updatedMessage;
	}

	msgStream.emit(message.rid, message);
}

export const executeSetReaction = async function(reaction, messageId, shouldReact) {
	const user = Meteor.user();

	if (!user) {
		throw new Meteor.Error('error-invalid-user', 'Invalid user', { method: 'setReaction' });
	}

	const message = Messages.findOneById(messageId);

	if (!message) {
		throw new Meteor.Error('error-not-allowed', 'Not allowed', { method: 'setReaction' });
	}

	const room = Meteor.call('canAccessRoom', message.rid, Meteor.userId());

	if (!room) {
		throw new Meteor.Error('error-not-allowed', 'Not allowed', { method: 'setReaction' });
	}

	return setReaction(room, user, message, reaction, shouldReact);
};

Meteor.methods({
	setReaction(reaction, messageId, shouldReact) {
		try {
			return Promise.await(executeSetReaction(reaction, messageId, shouldReact));
		} catch (e) {
			if (e.error === 'error-not-allowed' && e.reason && e.details && e.details.rid) {
				api.broadcast('notify.ephemeralMessage', Meteor.userId(), e.details.rid, {
					msg: e.reason,
				});

				return false;
			}

			throw e;
		}
	},
});
