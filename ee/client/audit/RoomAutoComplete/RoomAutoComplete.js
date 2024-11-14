import { AutoComplete, Option } from '@rocket.chat/fuselage';
import React, { memo, useMemo, useState } from 'react';

import Avatar from './Avatar';
import { useEndpointData } from '../../../../client/hooks/useEndpointData';

const query = (name = '') => ({ selector: JSON.stringify({ name }) });

const RoomAutoComplete = (props) => {
	const [filter, setFilter] = useState('');
	const { value: data } = useEndpointData(
		'rooms.autocomplete.channelAndPrivate',
		useMemo(() => query(filter), [filter]),
	);
	const options = useMemo(
		() =>
			(data &&
				data.items.map(({ name, _id, fname, avatarETag, t }) => ({
					value: _id,
					label: { name: fname || name, avatarETag, type: t },
				}))) ||
			[],
		[data],
	);

	return (
		<AutoComplete
			{...props}
			filter={filter}
			setFilter={setFilter}
			renderSelected={({ value, label }) => (
				<Option
					label={label.name}
					avatar={<Avatar value={value} room={{ _id: value, ...label }} />}
				/>
			)}
			renderItem={({ value, label, ...props }) => (
				<Option
					key={value}
					{...props}
					label={label.name}
					avatar={<Avatar value={value} {...label} />}
				/>
			)}
			options={options}
		/>
	);
};

export default memo(RoomAutoComplete);
