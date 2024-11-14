import React, { memo } from 'react';

import UserItem from './UserItem';
import SideBarItemTemplateWithData from '../RoomList/SideBarItemTemplateWithData';

const Row = ({ item, data }) => {
	const { t, SideBarItemTemplate, avatarTemplate: AvatarTemplate, useRealName, extended } = data;

	if (item.t === 'd' && !item.u) {
		return (
			<UserItem
				id={`search-${item._id}`}
				useRealName={useRealName}
				t={t}
				item={item}
				SideBarItemTemplate={SideBarItemTemplate}
				AvatarTemplate={AvatarTemplate}
			/>
		);
	}
	return (
		<SideBarItemTemplateWithData
			id={`search-${item._id}`}
			tabIndex={-1}
			extended={extended}
			t={t}
			room={item}
			SideBarItemTemplate={SideBarItemTemplate}
			AvatarTemplate={AvatarTemplate}
		/>
	);
};

export default memo(Row);
