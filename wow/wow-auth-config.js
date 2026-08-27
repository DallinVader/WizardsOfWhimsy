/**
 * Questline API base URL for Wizards of Whimsy sign-in.
 * Override before wow-auth.js loads if needed (e.g. local nst-ql).
 */
window.WowAuthConfig = window.WowAuthConfig || {
    apiBase: 'https://api.questline.fun',
    /** Questline permission strings that grant WoW admin (Card Maker, Saved cards). */
    adminPermissions: ['[Permission] superAdmin'],
    /**
     * Recommended pipeline:
     * 1) You save in Card Maker → Google Drive (authoring)
     * 2) Publish → catalog/wow-card-catalog.json AND create matching Questline Item (type card) per card
     * 3) Catalog lists every card; Questline ownedItems stores how many each player owns
     * 4) Pack open (Questline API, TBD) spends questCoin and adds card itemIds to ownedItems
     */
    accountCardsSource: 'catalog',
    /** JSON catalog — all playable cards on the site (published from your Drive saves). */
    sharedCardCatalogUrl: 'catalog/wow-card-catalog.json',
    /**
     * Catalog card art URLs:
     * - 'file' — relative paths (catalog/thumbs/{id}.jpg) + zip export on publish
     * - 'dataUrl' — embed JPEG data URLs in JSON (large file, no extra assets)
     */
    catalogImageUrlMode: 'file',
    catalogThumbBasePath: 'catalog/thumbs/',
    /** Item.type values that count as WoW cards (case-insensitive). */
    cardItemTypes: ['card'],
    /** Item category ids that count as cards (Questline category _id strings). */
    cardCategoryIds: [],
    /** Substrings matched against category names when the category list is available. */
    cardCategoryNamePatterns: ['card', 'whimsy'],
    /** Questline Item.type used when publishing catalog cards (POST /item/create). */
    questlineItemType: 'card',
    /** Optional Questline category _id strings attached to published card items. */
    questlineItemCategoryIds: [],
    /** localStorage map: Drive file id → Questline item _id (survives re-publish). */
    questlineItemMapStorageKey: 'wow_ql_item_map_v1',
    /** Firestore doc for optional live catalog (update firestore.rules.example). */
    firestoreCatalogCollection: 'wowCardCatalog',
    firestoreCatalogDocId: 'current',
    /** Booster pack definitions (account shop). */
    packs: {
        whimsy: {
            name: 'Whimsy booster',
            cardCount: 10,
            priceQuestCoins: 50,
            rarityPool: ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Fantastical'],
            /**
             * Fixed slot structure (fill order; reveal still sorts common → rarest):
             * 5× Common, 3× Uncommon,
             * 1× wild (50% Uncommon, else Rare+ with falling odds),
             * 1× Rare+ finale (Rare base, chance to upgrade).
             */
            pullSlots: [
                { rarity: 'common', count: 5 },
                { rarity: 'uncommon', count: 3 },
                {
                    count: 1,
                    weights: {
                        uncommon: 50,
                        rare: 30,
                        epic: 12,
                        legendary: 6,
                        fantastical: 2
                    }
                },
                {
                    count: 1,
                    weights: {
                        rare: 70,
                        epic: 18,
                        legendary: 9,
                        fantastical: 3
                    }
                }
            ]
        },
        legendary: {
            name: 'Legendary pack',
            cardCount: 3,
            priceQuestCoins: 200,
            minRarity: 'Rare',
            rarityWeights: { rare: 50, epic: 30, legendary: 15, mythic: 4, fantastical: 1 }
        }
    }
};
