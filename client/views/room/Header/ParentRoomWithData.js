import React from 'react';

import ParentRoom from './ParentRoom';
import ParentRoomWithEndpointData from './ParentRoomWithEndpointData';
import { useUserSubscription } from '../../../contexts/UserContext';

const ParentRoomWithData = ({ room }) => {
	const subscription = useUserSubscription(room.prid);

	if (subscription) {
		return <ParentRoom room={subscription} />;
	}

	return <ParentRoomWithEndpointData rid={room.prid} />;
};

export default ParentRoomWithData;
