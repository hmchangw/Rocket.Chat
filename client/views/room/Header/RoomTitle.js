import React from 'react';

import HeaderIconWithRoom from './HeaderIconWithRoom';
import Header from '../../../components/Header';

const RoomTitle = ({ room }) => (
	<>
		<HeaderIconWithRoom room={room} />
		<Header.Title>{room.name}</Header.Title>
	</>
);

export default RoomTitle;
