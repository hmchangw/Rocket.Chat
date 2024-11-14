import React, { FC } from 'react';

import MapView from './MapView';
import { IMessage } from '../../../definition/IMessage';

type MessageLocationProps = {
	location?: IMessage['location'];
};

const MessageLocation: FC<MessageLocationProps> = ({ location }) => {
	const [longitude, latitude] = location?.coordinates ?? [];

	if (!latitude || !longitude) {
		return null;
	}

	return <MapView latitude={latitude} longitude={longitude} />;
};

export default MessageLocation;
