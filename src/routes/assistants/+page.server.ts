import { base } from "$app/paths";
import { config } from "$lib/server/config";
import { collections } from "$lib/server/database.js";
import { SortKey, type Assistant } from "$lib/types/Assistant";
import type { User } from "$lib/types/User";
import { generateQueryTokens } from "$lib/utils/searchTokens.js";
import { error, redirect } from "@sveltejs/kit";
import type { Filter } from "mongodb";
import { ReviewStatus } from "$lib/types/Review";
const NUM_PER_PAGE = 24;

export const load = async ({ url, locals }) => {
	if (!config.ENABLE_ASSISTANTS) {
		redirect(302, `${base}/`);
	}

	const modelId = url.searchParams.get("modelId");
	const pageIndex = parseInt(url.searchParams.get("p") ?? "0");
	const username = url.searchParams.get("user");
	const query = url.searchParams.get("q")?.trim() ?? null;
	const sort = url.searchParams.get("sort")?.trim() ?? SortKey.TRENDING;
	const showUnfeatured = url.searchParams.get("showUnfeatured") === "true";
	const createdByCurrentUser = locals.user?.username && locals.user.username === username;

	let user: Pick<User, "_id"> | null = null;
	if (username) {
		user = await collections.users.findOne<Pick<User, "_id">>(
			{ username },
			{ projection: { _id: 1 } }
		);
		if (!user) {
			error(404, `User "${username}" doesn't exist`);
		}
	}

	// if we require featured assistants, that we are not on a user page and we are not an admin who wants to see unfeatured assistants, we show featured assistants
	let shouldBeFeatured = {};

	if (config.REQUIRE_FEATURED_ASSISTANTS === "true" && !(locals.isAdmin && showUnfeatured)) {
		if (!user) {
			// only show featured assistants on the community page
			shouldBeFeatured = { review: ReviewStatus.APPROVED };
		} else if (!createdByCurrentUser) {
			// on a user page show assistants that have been approved or are pending
			shouldBeFeatured = { review: { $in: [ReviewStatus.APPROVED, ReviewStatus.PENDING] } };
		}
	}

	const noSpecificSearch = !user && !query;
	// fetch the top assistants sorted by user count from biggest to smallest.
	// filter by model too if modelId is provided or query if query is provided
	// only show assistants that have been used by more than 5 users if no specific search is made
	const filter: Filter<Assistant> = {
		...(modelId && { modelId }),
		...(user && { createdById: user._id }),
		...(query && { searchTokens: { $all: generateQueryTokens(query) } }),
		...(noSpecificSearch && { userCount: { $gte: 5 } }),
		...shouldBeFeatured,
	};

	const assistants = await collections.assistants
		.find(filter)
		.sort({
			...(sort === SortKey.TRENDING && { last24HoursCount: -1 }),
			userCount: -1,
			_id: 1,
		})
		.skip(NUM_PER_PAGE * pageIndex)
		.limit(NUM_PER_PAGE)
		.toArray();

	const numTotalItems = await collections.assistants.countDocuments(filter);

	return {
		assistants: JSON.parse(JSON.stringify(assistants)) as Array<Assistant>,
		selectedModel: modelId ?? "",
		numTotalItems,
		numItemsPerPage: NUM_PER_PAGE,
		query,
		sort,
		showUnfeatured,
	};
};
