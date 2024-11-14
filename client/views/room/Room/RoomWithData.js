import React from 'react';

import Room from './Room';
import { useOpenedRoom } from '../../../lib/RoomManager';
import RoomProvider from '../providers/RoomProvider';

const RoomWithData = () => {
	const rid = useOpenedRoom();
	return rid ? (
		<RoomProvider rid={rid}>
			<Room />
		</RoomProvider>
	) : null;
};

export default RoomWithData;
