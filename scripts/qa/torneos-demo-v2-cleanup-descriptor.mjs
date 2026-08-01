// Generated only from commit 0dc66b5f0297d7c59be486559ec36c8c50779e96.
// Regenerate with generate-torneos-demo-v2-cleanup-descriptor.mjs; do not edit manually.
import { validateCleanupDescriptor } from './torneos-demo-v2-cleanup-contract.mjs';

const descriptor = {
  "version": 1,
  "sourceCommit": "0dc66b5f0297d7c59be486559ec36c8c50779e96",
  "seedKey": "torneos-demo-v2",
  "organizationId": "a5627c00-6b91-59b8-a366-455261e6e8de",
  "organizationSlug": "qa-metropolitana",
  "creationKey": "6d1f03ef-aa0b-5f63-afda-b23de0dd8718",
  "manifestHash": "48b413d1c6673ad96d3ce5bb30fecc89bd2c432b465a00447eb6f2cb51befb2f",
  "identityMapFingerprint": "77d95cb8caee567de1e8275b81c1e8c850eb59dcf6025504cab93c634ff3657c",
  "ownershipFingerprint": "9375b59f2f908aec4b0d5b32b79514491e2ebbd648c4d9e7c245064c772ebe8d",
  "expected": {
    "baseRows": 586,
    "markerRows": 1,
    "totalRows": 587,
    "tables": 32
  },
  "marker": {
    "table": "tournament_audit_log",
    "identity": {
      "resource_type": "qa_seed_execution",
      "resource_id": "b66dc982-e959-5780-8b72-ab70761e2bec",
      "action": "qa.seed.applied"
    },
    "contentHash": "a7f83d0aaac8e99736d309b395cb6be1824e827588a65c0bbe900a8e9fb59aad",
    "metadata": {
      "seedKey": "torneos-demo-v2",
      "manifestHash": "48b413d1c6673ad96d3ce5bb30fecc89bd2c432b465a00447eb6f2cb51befb2f",
      "identityMapFingerprint": "77d95cb8caee567de1e8275b81c1e8c850eb59dcf6025504cab93c634ff3657c",
      "ownershipFingerprint": "9375b59f2f908aec4b0d5b32b79514491e2ebbd648c4d9e7c245064c772ebe8d"
    }
  },
  "tables": [
    {
      "table": "tournament_organizations",
      "identity": [
        "id"
      ],
      "columns": [
        "archived_at",
        "created_by",
        "creation_key",
        "id",
        "logo_path",
        "name",
        "slug",
        "status"
      ],
      "columnKinds": {
        "archived_at": "nullable",
        "created_by": "scalar",
        "creation_key": "scalar",
        "id": "scalar",
        "logo_path": "nullable",
        "name": "scalar",
        "slug": "scalar",
        "status": "scalar"
      },
      "ownership": {
        "column": "id",
        "values": [
          "a5627c00-6b91-59b8-a366-455261e6e8de"
        ]
      },
      "rows": [
        {
          "identity": {
            "id": "a5627c00-6b91-59b8-a366-455261e6e8de"
          },
          "contentHash": "7f6e72dff48c94bbbbcf298d23b84909385738ba7a5c8e5e1c553a7d51f3673e"
        }
      ]
    },
    {
      "table": "tournament_organization_members",
      "identity": [
        "id"
      ],
      "columns": [
        "id",
        "invited_by",
        "joined_at",
        "organization_id",
        "role",
        "status",
        "user_id"
      ],
      "columnKinds": {
        "id": "scalar",
        "invited_by": "scalar",
        "joined_at": "scalar",
        "organization_id": "scalar",
        "role": "scalar",
        "status": "scalar",
        "user_id": "scalar"
      },
      "ownership": {
        "column": "organization_id",
        "values": [
          "a5627c00-6b91-59b8-a366-455261e6e8de"
        ]
      },
      "rows": [
        {
          "identity": {
            "id": "5d5fae7f-a2c0-5627-937d-1cf6d199daa8"
          },
          "contentHash": "cae648d1b2045b620fe8b6c195515bf48ca83a2d4bbf22e9d88b85fa3c28e064"
        },
        {
          "identity": {
            "id": "77f9e027-e6af-54de-9358-c9cc9ebd8fe9"
          },
          "contentHash": "5f8d7a96edb86ce0be4f6ed2f147ae27278937208604736c083554859705eb94"
        },
        {
          "identity": {
            "id": "e668a49e-6272-5f1e-a6bf-6db014c3e9ec"
          },
          "contentHash": "1e4bd51766de4792d46e6dcdeaaf1a212b09b63cf6547f7920c6df22a51ccbed"
        }
      ]
    },
    {
      "table": "tournament_seasons",
      "identity": [
        "id"
      ],
      "columns": [
        "archived_at",
        "created_by",
        "creation_key",
        "end_date",
        "id",
        "name",
        "organization_id",
        "slug",
        "start_date",
        "status"
      ],
      "columnKinds": {
        "archived_at": "nullable",
        "created_by": "scalar",
        "creation_key": "scalar",
        "end_date": "date",
        "id": "scalar",
        "name": "scalar",
        "organization_id": "scalar",
        "slug": "scalar",
        "start_date": "date",
        "status": "scalar"
      },
      "ownership": {
        "column": "organization_id",
        "values": [
          "a5627c00-6b91-59b8-a366-455261e6e8de"
        ]
      },
      "rows": [
        {
          "identity": {
            "id": "d8d6e4eb-ce0e-5d84-8263-4d441a68bdcc"
          },
          "contentHash": "d125219058208cb9c493d1061060b04a31511d9ea0b43d64f87b2c70f535d71b"
        }
      ]
    },
    {
      "table": "tournaments",
      "identity": [
        "id"
      ],
      "columns": [
        "archived_at",
        "competition_format",
        "created_by",
        "creation_key",
        "description",
        "end_date",
        "format_settings",
        "gender_category",
        "id",
        "name",
        "organization_id",
        "registration_closes_at",
        "registration_opens_at",
        "season_id",
        "slug",
        "sport_modality",
        "start_date",
        "status",
        "substitutes_limit",
        "team_size"
      ],
      "columnKinds": {
        "archived_at": "scalar",
        "competition_format": "scalar",
        "created_by": "scalar",
        "creation_key": "scalar",
        "description": "scalar",
        "end_date": "date",
        "format_settings": "scalar",
        "gender_category": "scalar",
        "id": "scalar",
        "name": "scalar",
        "organization_id": "scalar",
        "registration_closes_at": "nullable",
        "registration_opens_at": "nullable",
        "season_id": "scalar",
        "slug": "scalar",
        "sport_modality": "scalar",
        "start_date": "date",
        "status": "scalar",
        "substitutes_limit": "number",
        "team_size": "number"
      },
      "ownership": {
        "column": "organization_id",
        "values": [
          "a5627c00-6b91-59b8-a366-455261e6e8de"
        ]
      },
      "rows": [
        {
          "identity": {
            "id": "439fd0cf-ce9d-53b7-9d6d-d64d680dafd0"
          },
          "contentHash": "195da9f1689dc0f2779b64aaa23bcfa2096bf822dd461636771949e6a2a35516"
        },
        {
          "identity": {
            "id": "59dcf68a-d69e-545d-b1ed-c015558b2873"
          },
          "contentHash": "fc1432bb0e12178e6fafe4a50035a27d7b2115d30a8e77222d493b5f19d43ad3"
        },
        {
          "identity": {
            "id": "1b8663d4-a2bd-5740-b109-d5576493a444"
          },
          "contentHash": "f567f5e7351f00cb1e6bfeec128b862cfad15ae91916c6a4cde8eae7e8d757fb"
        },
        {
          "identity": {
            "id": "fd083bc4-29ad-5a00-b9ad-441df5358a1e"
          },
          "contentHash": "d8bbf2e95ab64fc1903d0a20b8eec2ccaf926fcdad2bf9c095b1d5ed9d8f8109"
        }
      ]
    },
    {
      "table": "tournament_categories",
      "identity": [
        "id"
      ],
      "columns": [
        "archived_at",
        "description",
        "gender_category",
        "id",
        "max_age",
        "min_age",
        "name",
        "organization_id",
        "slug",
        "sort_order",
        "sport_modality",
        "status",
        "team_size",
        "tournament_id"
      ],
      "columnKinds": {
        "archived_at": "nullable",
        "description": "scalar",
        "gender_category": "scalar",
        "id": "scalar",
        "max_age": "nullable",
        "min_age": "number",
        "name": "scalar",
        "organization_id": "scalar",
        "slug": "scalar",
        "sort_order": "number",
        "sport_modality": "scalar",
        "status": "scalar",
        "team_size": "number",
        "tournament_id": "scalar"
      },
      "ownership": {
        "column": "organization_id",
        "values": [
          "a5627c00-6b91-59b8-a366-455261e6e8de"
        ]
      },
      "rows": [
        {
          "identity": {
            "id": "6e91bbd4-db52-514e-a0b7-db44b6c91aa7"
          },
          "contentHash": "0066ca4b1b9be8ae4c7cd3dacf816a60a1dedb366a755d4a6a645ac71573f104"
        }
      ]
    },
    {
      "table": "tournament_team_entries",
      "identity": [
        "id"
      ],
      "columns": [
        "approved_at",
        "archived_at",
        "arma2_team_id",
        "category_id",
        "created_by",
        "id",
        "idempotency_key",
        "name",
        "organization_id",
        "primary_color",
        "registration_source",
        "rejected_at",
        "reviewed_at",
        "reviewed_by",
        "season_id",
        "secondary_color",
        "shield_path",
        "short_name",
        "slug",
        "status",
        "submitted_at",
        "submitted_by",
        "tournament_id",
        "withdrawn_at"
      ],
      "columnKinds": {
        "approved_at": "scalar",
        "archived_at": "nullable",
        "arma2_team_id": "nullable",
        "category_id": "scalar",
        "created_by": "scalar",
        "id": "scalar",
        "idempotency_key": "scalar",
        "name": "scalar",
        "organization_id": "scalar",
        "primary_color": "scalar",
        "registration_source": "scalar",
        "rejected_at": "nullable",
        "reviewed_at": "scalar",
        "reviewed_by": "scalar",
        "season_id": "scalar",
        "secondary_color": "scalar",
        "shield_path": "scalar",
        "short_name": "scalar",
        "slug": "scalar",
        "status": "scalar",
        "submitted_at": "scalar",
        "submitted_by": "scalar",
        "tournament_id": "scalar",
        "withdrawn_at": "nullable"
      },
      "ownership": {
        "column": "organization_id",
        "values": [
          "a5627c00-6b91-59b8-a366-455261e6e8de"
        ]
      },
      "rows": [
        {
          "identity": {
            "id": "61777276-5db3-59f5-8157-9fc36abc5e4a"
          },
          "contentHash": "7c90e52c530390048b2f4615b0049bef1ebe84bb96ded19d3bdd50eeecbe81f2"
        },
        {
          "identity": {
            "id": "9d379a8c-0d8c-5c27-bf0c-bb19ce2f2436"
          },
          "contentHash": "e8212960907d52508821c89dd2f4345ddbf86a8860a0fff05b2fa966b7c3c4f3"
        },
        {
          "identity": {
            "id": "d006fc94-e2a9-5eef-a834-9b97fec92773"
          },
          "contentHash": "ee82d1e1531f1f2c55fbd0835c926734f570aae77c1fa7c90e95dd5e407c0d37"
        },
        {
          "identity": {
            "id": "3260bd9f-8cd6-53ea-9289-171d97d4304a"
          },
          "contentHash": "970908b1deb30be00e5e4c5aae4cca133091d4d4f3869ef4c924aae9afdf685c"
        },
        {
          "identity": {
            "id": "8124a92e-ce16-55e4-bd96-d7837e9aee72"
          },
          "contentHash": "8a375feb87e4ac2f45bdf77b7dc66103c2fab53830a505d349618588d564599c"
        },
        {
          "identity": {
            "id": "84ba225d-e75c-5fc2-bcf7-57c6e322904d"
          },
          "contentHash": "d44a3981b90ad9ee3116acc12c656712ab0535e43fa1b426238c691ac458be58"
        },
        {
          "identity": {
            "id": "6c599546-caae-5da5-b868-96e9bd5255c1"
          },
          "contentHash": "cf0b8f507a6e220b41ab373ee1a066fe3df7fa9cf676777f993fdb04cb1dd0af"
        },
        {
          "identity": {
            "id": "0de30fe7-0306-588f-92c7-d56c67113b7e"
          },
          "contentHash": "f4655f6c919400180eb133daa2a8bbd46aa30ffdcbcf490784f3f58f2cc1bb01"
        }
      ]
    },
    {
      "table": "tournament_team_managers",
      "identity": [
        "id"
      ],
      "columns": [
        "accepted_at",
        "display_name",
        "email_normalized",
        "id",
        "invited_at",
        "invited_by",
        "organization_id",
        "revoked_at",
        "role",
        "status",
        "team_entry_id",
        "user_id"
      ],
      "columnKinds": {
        "accepted_at": "scalar",
        "display_name": "scalar",
        "email_normalized": "scalar",
        "id": "scalar",
        "invited_at": "scalar",
        "invited_by": "scalar",
        "organization_id": "scalar",
        "revoked_at": "nullable",
        "role": "scalar",
        "status": "scalar",
        "team_entry_id": "scalar",
        "user_id": "scalar"
      },
      "ownership": {
        "column": "organization_id",
        "values": [
          "a5627c00-6b91-59b8-a366-455261e6e8de"
        ]
      },
      "rows": [
        {
          "identity": {
            "id": "9d73a81e-3970-5f4f-af0e-f687fe599354"
          },
          "contentHash": "8eab6bc26909a17e3223b61f77f249b9e937211bca5265a282518308268f165a"
        },
        {
          "identity": {
            "id": "dc874b28-1e91-5f50-b749-312cac3d8674"
          },
          "contentHash": "e91d685375a4392b9a6d2e385941638bcc95c31f89209b93839dcfcfb2e61c98"
        },
        {
          "identity": {
            "id": "ae50fddc-687b-5251-9c4f-870bc48f0c31"
          },
          "contentHash": "3447dfd468661eb45bb1958091f699623edc328369fbde981e791cde12b17ada"
        },
        {
          "identity": {
            "id": "8846dd97-2fb1-5ee4-b180-026dec1a7717"
          },
          "contentHash": "4a9aac841ab52008958887bfa93c9e135914622535f5e6e54f27bed797411013"
        },
        {
          "identity": {
            "id": "87350d06-c6ce-5967-b687-0de9b066a404"
          },
          "contentHash": "bc2cf97021f631fff4817951da0809c080299bf159fe8f757ec181e27d74ee4f"
        },
        {
          "identity": {
            "id": "70a07fbd-1c7f-53ad-b40a-c47851d09290"
          },
          "contentHash": "2a33a564c9333a5a9306f3ff7ae7b26b20852346322415f896642eff2284556d"
        },
        {
          "identity": {
            "id": "e4010a59-9fe2-5945-bfc7-ec74bcb694e1"
          },
          "contentHash": "3a78f070c68771e35345dd0ba2386c9f414262108423bbf5fdddd1470dedfef5"
        },
        {
          "identity": {
            "id": "793741bd-1332-5117-a8e1-35d514374ca0"
          },
          "contentHash": "5a2d217d76ba716d0b01b58a677e4b2e2807b941d2c4ccdfd183d58dc45601d0"
        },
        {
          "identity": {
            "id": "9d1752a1-b0e3-5f88-8615-a5ca709542c7"
          },
          "contentHash": "f959d6a1e0f298ed27bc3d14d16f6f21582c4bce9afb33bcce2aa6bfc31d608e"
        }
      ]
    },
    {
      "table": "tournament_rosters",
      "identity": [
        "id"
      ],
      "columns": [
        "approved_at",
        "created_by",
        "id",
        "locked_at",
        "organization_id",
        "status",
        "submitted_at",
        "team_entry_id",
        "version"
      ],
      "columnKinds": {
        "approved_at": "scalar",
        "created_by": "scalar",
        "id": "scalar",
        "locked_at": "nullable",
        "organization_id": "scalar",
        "status": "scalar",
        "submitted_at": "scalar",
        "team_entry_id": "scalar",
        "version": "number"
      },
      "ownership": {
        "column": "organization_id",
        "values": [
          "a5627c00-6b91-59b8-a366-455261e6e8de"
        ]
      },
      "rows": [
        {
          "identity": {
            "id": "dcde955b-7628-5b9e-b7b7-e8433c6d11d9"
          },
          "contentHash": "804871302239393bb59a8c0ea22284df6e728c70ff611e8c57bac0313052e938"
        },
        {
          "identity": {
            "id": "4b2c6c6f-98f5-538d-bfab-c57300e452af"
          },
          "contentHash": "47268a55fe44bad0427a17543305e0efa5d0c48870444801a02db88b0578c1d8"
        },
        {
          "identity": {
            "id": "a4804352-c9d2-599a-af1a-89cdb0c0a61d"
          },
          "contentHash": "a3f3d709149935b5f73ea155aa46a9c3c9fb4d8c903602880bdbe6cbc0da9143"
        },
        {
          "identity": {
            "id": "e88ab0ca-81f1-53e1-8607-db9f1d623599"
          },
          "contentHash": "35ef245db19753e2cc3c1d84e156d72b1c25ea5a200a6cf370e97befa8270bb5"
        },
        {
          "identity": {
            "id": "7b253432-5f88-5170-8981-7f0da28eddac"
          },
          "contentHash": "1fc30ced30d6319812ae217a5e84b42bc4646f76cf388c1eab73ab0cc7054c67"
        },
        {
          "identity": {
            "id": "7f6c1a22-727b-534c-baee-f34f1f8b2168"
          },
          "contentHash": "73d4f41b6661bbf4e7305c531519a4dcf375a122e0441dec3692cdcf9ba134e6"
        },
        {
          "identity": {
            "id": "ae47c797-8a34-578d-bc1f-176c96f1fdd6"
          },
          "contentHash": "66a635ea44f9b27d86e397466fac190724c5e32b6b7425d7de3733e16d8652e0"
        },
        {
          "identity": {
            "id": "86d19fde-4a20-5203-b066-c743477fd578"
          },
          "contentHash": "0f8ad6ae5f494184d633199e1242457e9dab65b9ad674057d695eb8ecbbd840e"
        }
      ]
    },
    {
      "table": "tournament_provisional_players",
      "identity": [
        "id"
      ],
      "columns": [
        "claim_status",
        "claimed_by_user_id",
        "contact_email",
        "contact_phone",
        "created_by",
        "display_name",
        "id",
        "normalized_name",
        "organization_id"
      ],
      "columnKinds": {
        "claim_status": "scalar",
        "claimed_by_user_id": "nullable",
        "contact_email": "nullable",
        "contact_phone": "nullable",
        "created_by": "scalar",
        "display_name": "scalar",
        "id": "scalar",
        "normalized_name": "scalar",
        "organization_id": "scalar"
      },
      "ownership": {
        "column": "organization_id",
        "values": [
          "a5627c00-6b91-59b8-a366-455261e6e8de"
        ]
      },
      "rows": [
        {
          "identity": {
            "id": "ddf53bba-16a6-5a7f-892d-fd6f30853e8f"
          },
          "contentHash": "d52fad18b6d62a7c2f8843c2ca8bb8fe025eb108a689f8640b8436bc43504ff5"
        },
        {
          "identity": {
            "id": "40e9d6d5-eb1e-5d4b-aab3-0f88ede771c7"
          },
          "contentHash": "9b1f74e12610e153bcaabc0710d00b5bd5a9a2f5ba3fa3d965e1c91c6b3fcc7e"
        },
        {
          "identity": {
            "id": "9cc23f13-a67a-51c9-8aa6-2465d581da38"
          },
          "contentHash": "e09f722f918817f1c1c94bc63ec581453a62c556c92ebce4812d44f17a8af24a"
        },
        {
          "identity": {
            "id": "81de6ccc-e024-56ad-b5f2-62dc948875d7"
          },
          "contentHash": "210a87cfa4435306f1c11d93408217e7867045932cbab336a690b3da322dc8fa"
        },
        {
          "identity": {
            "id": "95beb277-e00c-5062-b2d5-dc3dab054348"
          },
          "contentHash": "9268dff84bb0be0f11ca980d1e45fb96998ccec95b70c494db59f708cf35f4ab"
        },
        {
          "identity": {
            "id": "8c6c5628-165d-5a87-895f-61deba280b22"
          },
          "contentHash": "34357766fe667b36e90b3332bc389fcffdf9c4fe9933c7095739f626772ad324"
        },
        {
          "identity": {
            "id": "ded6efee-7474-5244-ac84-50c6611d418e"
          },
          "contentHash": "a81eb56412583c72ffc2c48bf51da50dc93b703773f159cb2039a33a16a427f4"
        },
        {
          "identity": {
            "id": "0ecde399-9e8e-5e3c-8bc9-2325c0866494"
          },
          "contentHash": "0e02448347c8a0bada704553f468aebecbd010935ea7435e812ce2db019e01ae"
        },
        {
          "identity": {
            "id": "65ea618a-561a-55c9-8dd6-ee3afaa7a1d7"
          },
          "contentHash": "7d75f328a9cbbbc93b0ed31659e91d82f41301d218f167d8a70ee3e75182102c"
        },
        {
          "identity": {
            "id": "76a33434-3bb6-5618-a662-b7d282fcb0cb"
          },
          "contentHash": "d050e34b42ba2e03a89a280db91deadfdc6d6a86e390d7bc4f985a6b357accf5"
        },
        {
          "identity": {
            "id": "c039f394-4ad4-52f6-a77c-bdc94decf370"
          },
          "contentHash": "4f00a6bc6c5fb3d23c367b53903e383e8eab18bee191ff66af96641576cf2407"
        },
        {
          "identity": {
            "id": "7f511435-0bd8-5054-83fd-84d2f4ff6d46"
          },
          "contentHash": "51e87f6c6d631fdc2e561f56cb3c1355678c598472bba4c7869f69b96d4e3699"
        },
        {
          "identity": {
            "id": "dea39d5d-abf8-5a46-bb64-8c4c7f304ec0"
          },
          "contentHash": "7ee84e4afa41283cad27d7d6ea804746400bfb808b38ed3e64936f9ee0a00f86"
        },
        {
          "identity": {
            "id": "fb1bae3d-cffb-57d8-8035-bb15b99b32a3"
          },
          "contentHash": "ab4532e533e9634b80f6a8290556a02b9791e498245cd81cdd7a7470f4610eb6"
        },
        {
          "identity": {
            "id": "4b043bfc-4774-5540-a125-6dcbe34a702f"
          },
          "contentHash": "13a058205be2a171de50a00e82302a4b31e5b5a95485fceb469db1d7285e1993"
        },
        {
          "identity": {
            "id": "625ce57a-88a6-5ef6-b3cb-c5d9b5a7ce07"
          },
          "contentHash": "673467a76e069509e2898f55f515809090b854f4e87ca8f72de4cfbb6e8aa626"
        },
        {
          "identity": {
            "id": "26fd181c-3f2f-5b10-9407-88acad531ad4"
          },
          "contentHash": "ace7d02ead5759af092cb94cf8d9564c54e2e81139a80d392a23d6d3df260d0f"
        },
        {
          "identity": {
            "id": "c2e608c1-182d-5c49-ae55-778c7b9dc328"
          },
          "contentHash": "3acbccbbaac2cd0b06babd38fc8f125fbf1fbf9aa1a3cf685fad8b601efc3e51"
        },
        {
          "identity": {
            "id": "fd207cb7-03cd-5e49-98eb-3a0e458e85de"
          },
          "contentHash": "a31c97324f0dba2408f84c163be97991565868e7b74996abe4d0d585c6e67eac"
        },
        {
          "identity": {
            "id": "3c8dc5a3-068f-551f-b0e7-e704f0b7f485"
          },
          "contentHash": "36083ee4d8ec33fe540ab35688459ccea14574bda11cb60e8d60c8737d30f1f7"
        },
        {
          "identity": {
            "id": "30f67738-3322-522e-bfa6-d347de0de85b"
          },
          "contentHash": "5b8c08f44da996c3c8d9597c8e43d90870476533ff23e7bd854bf8421bf7c432"
        },
        {
          "identity": {
            "id": "ede6315e-9eb2-5545-9aa2-1f1c7ef41e14"
          },
          "contentHash": "61138993570937be5038eb757e0bc83ad84f8dbbc71392e4008fae91969dd5c3"
        },
        {
          "identity": {
            "id": "11a952c1-cd03-58ae-8261-dddcef207675"
          },
          "contentHash": "bf36cfd053b6a7c45178ac55ad7373ccbdbd746789b357d7c21c482142584bac"
        },
        {
          "identity": {
            "id": "0abc1ebb-dbbe-5308-a69b-8ed4e1546415"
          },
          "contentHash": "b2885b0d2a8a683337aaae077d252894893656bb0de664cfb9041903438e8ff6"
        },
        {
          "identity": {
            "id": "2c62cfdb-7b8f-5b94-a59a-6ae24467c077"
          },
          "contentHash": "7744340f525319534bcc89e99d187701383d8850cdb354a0f4f6afd8b90881e7"
        },
        {
          "identity": {
            "id": "79a2f655-e4cb-5ab6-955c-6cddd5e120d9"
          },
          "contentHash": "1c2b5ccb5398cdcc7d90b392913e71e7cee463d2ea78fbb07832ee76dd70eb6e"
        },
        {
          "identity": {
            "id": "7b18e2b3-8360-50b8-8d15-ad270bd09184"
          },
          "contentHash": "048fe383606507f293d698108a1f3241d5b684c41309f895cec6be98239bd82a"
        },
        {
          "identity": {
            "id": "a642d32d-4d6f-5b6b-915a-ad6541d90e0d"
          },
          "contentHash": "9c57b414c64548b813801f77400f4e80cdc288553364edfaf8028a7ad175571d"
        },
        {
          "identity": {
            "id": "2ee85554-58c0-5383-9ebe-46ad15cf255c"
          },
          "contentHash": "e16aa242dd9a32d173dd83197c5c3e80950523c196e993307d8cdd53205dd1ba"
        },
        {
          "identity": {
            "id": "312907fe-e88a-5e3e-9a33-568f998b423f"
          },
          "contentHash": "d85deb7c34e17b72a9619d0342cf4e188c2d9d66abf43831c8c122d18f59a636"
        },
        {
          "identity": {
            "id": "b630c29f-6dd5-55c1-8dea-0330cc504f68"
          },
          "contentHash": "9207e2f7c63ad7383203e8f4e7e000aa1e7fcc06bc3d68563d7d97a86b937f9d"
        },
        {
          "identity": {
            "id": "f46dfbd5-ee24-5d28-a3af-d63e48639bb6"
          },
          "contentHash": "55882053189da7c7c912a6919ca1f49bd94088fbd904fba1690721ac576df952"
        },
        {
          "identity": {
            "id": "86b3b834-c7f5-539b-8b2b-a4e669d3882c"
          },
          "contentHash": "4c47755e12d153505624ee037f872e011339f48185196e077a718bf8103ab6b9"
        },
        {
          "identity": {
            "id": "47084f61-92af-5726-9259-a3f052c5ac52"
          },
          "contentHash": "c9fe33124dfcdb4c787235fd3d09f7d3bbb96817bb79a79247928306fc3c585a"
        },
        {
          "identity": {
            "id": "09718fc2-34aa-5218-b4c5-7c2b2f989281"
          },
          "contentHash": "7802ec7b5cb51eb8630d019ec32da6e6b563e55cbe6d9842843b7e358cc53ee4"
        },
        {
          "identity": {
            "id": "1db5b1c4-ac3f-5e21-a04e-afd5ed2f3cca"
          },
          "contentHash": "f077a2d41c2a6be8dad599a3cd48ee248c0fdba17d8b7b0b42f3ad803b3154cf"
        },
        {
          "identity": {
            "id": "023293e6-aaaa-5e7a-8fd5-138a59e09ba9"
          },
          "contentHash": "9202eef0a73869828ac211531de1519a71e2f749f32a9b180cfd4afa490ecd65"
        },
        {
          "identity": {
            "id": "d1b0dda4-329e-5bc9-82d2-57d6b4929e33"
          },
          "contentHash": "533f393d2b279e4bef65030a11b7fb47483f337f0d7f1c87c1062bd1b3b288e0"
        },
        {
          "identity": {
            "id": "4a0ebf99-a552-53d9-83e0-91f587f3ff0b"
          },
          "contentHash": "6351256bf1373cf4e3e967aca46bbd28cb166e1bd6d994d860a6a4f4e9dd8cde"
        },
        {
          "identity": {
            "id": "889f817c-68aa-5662-91fe-bf54df486af3"
          },
          "contentHash": "3319881d24ce7f26cb006649e2559b6a877a17cd963cd32d8412e6c56909df2e"
        },
        {
          "identity": {
            "id": "b6ce9e7d-8dd4-54d2-ace9-aa3e41090c6e"
          },
          "contentHash": "f65bd541ba7ae1e749a5a5aefa48509eceb6f135c02383005ed20d1e7f3dc28e"
        },
        {
          "identity": {
            "id": "b613ab92-c57f-5430-8951-fa2e62d4a61b"
          },
          "contentHash": "d40b2b543fee98ebbf5d29302a707f450c5bb2e8af8e89ae74ce81042d51f941"
        },
        {
          "identity": {
            "id": "8db4c3b9-dbe7-558f-b797-e6a6e5838633"
          },
          "contentHash": "027a42d29c630986b419d59828cc50b50ac668176db0d193ab2c240706fd7fa6"
        },
        {
          "identity": {
            "id": "55c53c79-bf84-53e7-bff4-a28a59d9a1f0"
          },
          "contentHash": "8c28207cdeb0a3020056ecc04900d618d27d5b00edb0a167779975f7c550443d"
        },
        {
          "identity": {
            "id": "4289b130-76d5-521d-a9f6-749817e9fee1"
          },
          "contentHash": "3ac560bbf511b576ada63c1313844bb6616884e7d4939bca5dbafa31a4956a51"
        },
        {
          "identity": {
            "id": "b5a7d03e-8018-5ec7-b0af-10e60fd14623"
          },
          "contentHash": "8d6ce9d41192c7461c3f5de0a271979828444e649e7dcca1dc8e03a18e78bd51"
        },
        {
          "identity": {
            "id": "200ee57e-9e03-5cf5-a8e0-2fbbed9d287c"
          },
          "contentHash": "c3f0c7801714c3de887b8043d3f4db7c75ec2dc600d59d115c73028d5d11168a"
        },
        {
          "identity": {
            "id": "25aa324e-8df3-5f9e-84dc-93d51407217f"
          },
          "contentHash": "625484ae4e69f4d2f640ab7ba68926f73aafc730f8f65709baefb21297f8cd89"
        },
        {
          "identity": {
            "id": "ade7fa97-005a-562c-a76d-f8cdd87a76e6"
          },
          "contentHash": "bc0f90e178ccc9f63e5e55caaa653d4d1357483c35235c79d2dfcbc1b5698677"
        },
        {
          "identity": {
            "id": "1d3ee2bf-64cd-5c77-bdb6-5baf6ce30973"
          },
          "contentHash": "7e68f5a0fa835c4ed3314b0776858a93bb22da291368ffc5a7c813e591b9a8fa"
        },
        {
          "identity": {
            "id": "73c7a4be-80bd-517c-a065-c8f73a0e70e1"
          },
          "contentHash": "fd6c2bdbd5e5ea570053b20566b552e40147bf0cdcf620cd8d579cdae6b45451"
        },
        {
          "identity": {
            "id": "1cdce42a-b9d0-5070-a202-24bacf8c812e"
          },
          "contentHash": "1959d8c838763285906f3b542a7f746b55fcb1e5d59ad036946ced5c77d7c63f"
        },
        {
          "identity": {
            "id": "02277042-d1d7-5adb-b9b5-092e5ef3676a"
          },
          "contentHash": "70807c45bdac3fa6734d9204a7f75c8c9826bed1d0e4253a4452387aa4e19dd4"
        },
        {
          "identity": {
            "id": "982bb4fd-4a51-5455-a614-04fe209cba75"
          },
          "contentHash": "db5d2290952d3338f6ae8a785f5a36ce89bee7bdd0c3c0c71ea56ad289e3d85a"
        },
        {
          "identity": {
            "id": "cf80964b-2ddc-5eb8-94f4-557c1ccb35f9"
          },
          "contentHash": "7dca998df182ec1ceaaacdd346727e5c967afe9df4904415661959bef17f6a69"
        },
        {
          "identity": {
            "id": "312bffc7-2a11-5759-88e7-01edd67a07a9"
          },
          "contentHash": "0bbf6c6a2f446fdc0130ae4515e2155897b9a9de3b119ba1dcd68e6e9dc2040e"
        },
        {
          "identity": {
            "id": "299aeb49-f321-5c1a-9b6c-f0a5ed712cfb"
          },
          "contentHash": "2eea281b65d42e82a903427e9b49f0f948b2efe938b12cde31105a03f80856aa"
        },
        {
          "identity": {
            "id": "a5289006-df83-53c6-8d82-6ec114c2ec7b"
          },
          "contentHash": "f916aceafbcb548175b7c919c5d184c75ca7d72ca04adfd64ea36103774ee431"
        },
        {
          "identity": {
            "id": "48c8c0c5-d944-5a8e-8cf7-9ae57413b4d9"
          },
          "contentHash": "29f07b945ca77518fe0ee39e68bbc067525b4220fb302e70105e2e59f632f8c2"
        },
        {
          "identity": {
            "id": "ad55326c-12c1-52ac-98e7-038199272c42"
          },
          "contentHash": "bb846e4ddec72906e91438f2a458a5825d453225105aec03cd9b021d666edbde"
        },
        {
          "identity": {
            "id": "2988c442-3ee9-5392-8c8e-823a32602045"
          },
          "contentHash": "c3d693716c9e18a605d8fa17c49cadaa7e40af4dfc8c5048eedafccac14b7d86"
        },
        {
          "identity": {
            "id": "ebb276f2-fb1e-5037-9b54-f2a9a3751d3f"
          },
          "contentHash": "f594df6ef38949702d082066e3ee8b0622ac15d19f4b06bc722eed9dd36ae2d0"
        },
        {
          "identity": {
            "id": "857b556d-a9d1-51cf-8ce3-3c1d794c9c56"
          },
          "contentHash": "55586feb1457fbf16594934a6669dc863a61912cb1510ff947ab23600a3172d5"
        },
        {
          "identity": {
            "id": "8c87ed0d-3f06-563d-9f6e-2e7ef05e8d0c"
          },
          "contentHash": "adb70dbc1182910bf3b57da30db9e00726bf14bfc309c95a425ee223d677b20d"
        },
        {
          "identity": {
            "id": "efebfbae-6190-5e03-8a35-247f071a172d"
          },
          "contentHash": "d21c7a56d998daa776fd8430eefc4757dd975cf1866e329a4cdd7f4aa4bd188c"
        },
        {
          "identity": {
            "id": "fa9a206c-3603-5329-a609-d300ec2918c5"
          },
          "contentHash": "09815f40bedbcf1d990b3a4dd80f3867605c9c93280c4afe60675dcd684ce8f2"
        },
        {
          "identity": {
            "id": "f18ea5ba-1d89-5472-b82a-3e35cfcde017"
          },
          "contentHash": "5618230bc5f5c08ef3043cf0e764970b197e5368ab408b39531f377ab09bdab2"
        },
        {
          "identity": {
            "id": "c8b852e3-609c-5dc5-b806-0c7bc5056d1b"
          },
          "contentHash": "4ec9eaebd0057b0ca3481b11a465afae850d9525bd645dad92d3a7c25fa0ba20"
        },
        {
          "identity": {
            "id": "ac0d3986-2206-5841-8f1e-d87b80d31b52"
          },
          "contentHash": "d8819ea2465279874cc693bb5acb1054d8879ae56ec4056aa6cd70aea26469aa"
        },
        {
          "identity": {
            "id": "77526dd2-c69d-580b-a0e0-a55dd9ec2c87"
          },
          "contentHash": "c7ad65093676c0bfe9d2dbffa5f562a214f1a1388f4dd6a4d0ea5b42175e54fa"
        },
        {
          "identity": {
            "id": "57d74e15-5a09-57c6-a8df-f976fd959882"
          },
          "contentHash": "ba1c5e228a8c6bf2af1e9e61d9bf4d09c36f22478fd1ed6cc41d64bea879139f"
        },
        {
          "identity": {
            "id": "4f069418-fa1a-50dc-8450-decace97ea40"
          },
          "contentHash": "967cc9378af9cdab69f22a337a8984751bf65ef856be64592cdcae4a506c10b7"
        },
        {
          "identity": {
            "id": "db5ee216-8437-558b-881b-af249abb8d97"
          },
          "contentHash": "dfc1d80e0c966dc4f95d9b85e74907b581d7a88470baf4bbb8d7b57323d1301e"
        },
        {
          "identity": {
            "id": "c3a77f89-7ae3-5fbe-bf8c-36e7d371db77"
          },
          "contentHash": "88c2f8a652665996db36e1ed15689c93d40b39a60535d39369cca2585563edd1"
        },
        {
          "identity": {
            "id": "68dba63e-e426-5286-94e3-ca7b0a02108e"
          },
          "contentHash": "10937e35861cf299429a36045cefef27b9da132d52a4cbdf538301443e66b488"
        },
        {
          "identity": {
            "id": "4d425021-28cb-5735-adc1-97939620413e"
          },
          "contentHash": "38d21950e23d06dd0688a1efda32f4afe1b4b8d58a90f231b72b5f91113ce924"
        },
        {
          "identity": {
            "id": "3e9d6743-61e2-52d9-ba1c-d09d3ceeff3f"
          },
          "contentHash": "c256fd915a9c59a1def14ee010aa7c93f015ecfca14316b2564787a7ee59ed64"
        },
        {
          "identity": {
            "id": "576de6d0-ecd1-5522-b323-d3c501caa8e2"
          },
          "contentHash": "88238610ab0c245643282aaa5988ed2d9248dbdc9fbb94c0145860de23df5532"
        }
      ]
    },
    {
      "table": "tournament_roster_players",
      "identity": [
        "id"
      ],
      "columns": [
        "added_by",
        "arma2_user_id",
        "avatar_url",
        "display_name",
        "eligibility_status",
        "id",
        "is_goalkeeper",
        "organization_id",
        "primary_position",
        "provisional_player_id",
        "roster_id",
        "secondary_position",
        "shirt_number",
        "status",
        "team_entry_id"
      ],
      "columnKinds": {
        "added_by": "scalar",
        "arma2_user_id": "scalar",
        "avatar_url": "scalar",
        "display_name": "scalar",
        "eligibility_status": "scalar",
        "id": "scalar",
        "is_goalkeeper": "scalar",
        "organization_id": "scalar",
        "primary_position": "scalar",
        "provisional_player_id": "scalar",
        "roster_id": "scalar",
        "secondary_position": "nullable",
        "shirt_number": "number",
        "status": "scalar",
        "team_entry_id": "scalar"
      },
      "ownership": {
        "column": "organization_id",
        "values": [
          "a5627c00-6b91-59b8-a366-455261e6e8de"
        ]
      },
      "rows": [
        {
          "identity": {
            "id": "a3370601-8ffe-52a0-a802-b6d376a528e2"
          },
          "contentHash": "2032c06ceb90ef2a0ff22486898e1752849e8cf2796d71731fd4ee401bec86e8"
        },
        {
          "identity": {
            "id": "09041088-abbd-50ec-b204-17b234ceb7c4"
          },
          "contentHash": "0e0784fdc8c71459af4552a953c2894a1f7475e53119ca1ede6866528cefa7b9"
        },
        {
          "identity": {
            "id": "f7e913bd-82c7-5e19-9d6d-92a269fc8316"
          },
          "contentHash": "8c81397e168b006fa992e428745aeaacf57db27c1df57e935dd692af1471c546"
        },
        {
          "identity": {
            "id": "8127640a-e75e-5f52-8ae1-edb800c6ba1b"
          },
          "contentHash": "e0a052c0492c0ea939f1cd2ed42f8db3d895f5dd957f72e77a2a0b360f0c37c8"
        },
        {
          "identity": {
            "id": "2f63fd46-40a1-5d33-8e97-737792e99267"
          },
          "contentHash": "6bba843fd4b73ebb3f3110c159ec46b4e1640ac03617f3e522e3c48bf24022ba"
        },
        {
          "identity": {
            "id": "f3377467-58aa-5a64-ae7a-6201e1c69bf0"
          },
          "contentHash": "7624ee9223b28c1da65a930d4697a20ea8f7ce9803ec8fd40ccf47b5dafa5eb2"
        },
        {
          "identity": {
            "id": "b8a58b12-1d19-5825-9480-a856806dac32"
          },
          "contentHash": "ac84ccbd171710849d3c8a7b5a474d6c8fd2ce6801d448e13066f89ac0b38430"
        },
        {
          "identity": {
            "id": "82acf485-5ca9-5013-81ef-7a25fbad611c"
          },
          "contentHash": "a73f6567ab582d9a26eb3be9e08d366faa69c9c2d740aa5b2990492bac32e4f8"
        },
        {
          "identity": {
            "id": "26d604b3-1ed3-5882-9e70-1351080aac33"
          },
          "contentHash": "6dc8383947a635302c6b0e4e8d1386b5c2c7860c4af5fe845013e2ae6725e3c7"
        },
        {
          "identity": {
            "id": "ee418f7f-bece-5ef0-86de-f009fff075cd"
          },
          "contentHash": "258b706669f3ca8589605345f50aeb09e9595c9f0e8fd723e51cd1cc4000df31"
        },
        {
          "identity": {
            "id": "04c7f123-49ee-56c1-9d59-217ee3aa05e5"
          },
          "contentHash": "58bec60f4c8f7722b6aa0d7f9f2475eed6553410341f94227bd90571114d3a44"
        },
        {
          "identity": {
            "id": "0ddb9b5b-233a-5eac-a2c2-8468ef590d7d"
          },
          "contentHash": "d225b249f39d2d566e35b065c2cd3a6f772919b8e1d00229af03671da2bd00c3"
        },
        {
          "identity": {
            "id": "4ab0a4b0-d0c4-5d0a-a369-e83d2eaa298a"
          },
          "contentHash": "772664b779529e47f0d379e18703f17a8b84b1f08fb8b288615a395c00a8733d"
        },
        {
          "identity": {
            "id": "509722a4-f3f9-5b9a-929e-5fb4aa2b5002"
          },
          "contentHash": "6187a6df7275f825b150b7340a3f7006d47701e41a000e4cd8c879216c343653"
        },
        {
          "identity": {
            "id": "f08ffb2a-8cb7-5044-abe7-ba30a33952c6"
          },
          "contentHash": "ba9c608a7b8d3f31890e45414cb6dce19a4e85a404d89bacadd97835417a7bd5"
        },
        {
          "identity": {
            "id": "8eb4fa1f-082e-5c59-94aa-7d2e9fb48d55"
          },
          "contentHash": "0d6be6aa99671879223fd2b6b0be9473311d95b85bc79f909a92d7ea80c2edc9"
        },
        {
          "identity": {
            "id": "57775a92-3b49-5af3-a616-a1e95dbb35c5"
          },
          "contentHash": "b06150d53b34f99a8ecb1604c05187ab44a562e5334a0660d87f1d950a9cc006"
        },
        {
          "identity": {
            "id": "ab200de7-647b-53b1-bbaa-62fffd909efd"
          },
          "contentHash": "f64ccbd2d23a828eeb5d51271d2995cf147c56a43045cc2c35604310af4bc41c"
        },
        {
          "identity": {
            "id": "5ac9461f-910d-562d-97ff-07c4ac79f910"
          },
          "contentHash": "17ba03a47cebf655cd1976ba86a9755d810960b12b6588173be2a309f6d981af"
        },
        {
          "identity": {
            "id": "0a657f11-3094-5529-9f50-b0631cfda684"
          },
          "contentHash": "a8e92ad0becc0dd6f2f49ccba3127dd4d10ad86ce7d5d2f348fc5f1f6a658568"
        },
        {
          "identity": {
            "id": "bb8f6fbe-6666-56d2-ab1a-fffa30d6e65b"
          },
          "contentHash": "62a2abcfc04ad24b16931ef47b56a0f52ee2771f98d31241fcf6bce5bd533e33"
        },
        {
          "identity": {
            "id": "776ff550-fcf5-5e10-9f57-0ccd4e4405e9"
          },
          "contentHash": "5e1ceea51fb0e924621d14b602899abf136e355cae85fd6a2afdbd629304172f"
        },
        {
          "identity": {
            "id": "85a0d7c3-cfa1-59c3-b567-aa38b95cf827"
          },
          "contentHash": "52320cf9ae0517170c5c729d4ccff98500635af26e9201a1d8dadb492c2f8727"
        },
        {
          "identity": {
            "id": "d71c8fe8-510f-5963-934f-07fd65292c0f"
          },
          "contentHash": "1cb8af4f027a602989e37438b74fb4d210e77ad9de1f808858c02debd4a21dc7"
        },
        {
          "identity": {
            "id": "9a553853-a047-51b4-bf19-cd80b83a2b97"
          },
          "contentHash": "9f18ac5d935ba9deba135dbcfce33ebac7c19cc82bc6f4d894662ba9f59bb21a"
        },
        {
          "identity": {
            "id": "277fe194-34bc-5285-8089-4a89e9fb06d2"
          },
          "contentHash": "7062813e95cb5708f9e96bcc93bd400641574854e4c8fb136faf88b072cdb714"
        },
        {
          "identity": {
            "id": "5cadd48f-f9f7-5cf7-b8d1-33183a86b2b3"
          },
          "contentHash": "b9a2362d60b94a79713ff78dc31cff87c58604ccb4eefca2cfb5357604c1e4ef"
        },
        {
          "identity": {
            "id": "5479dec0-6e98-5f80-845a-49022ba50857"
          },
          "contentHash": "46541933635c46838a3ccc35211a6e51a2958b4dc98e1321185222185df0c103"
        },
        {
          "identity": {
            "id": "76ab5c86-aa31-5f89-b23a-ac230272f318"
          },
          "contentHash": "f0183b5b7c1e2ee7cbe6d1f6a1abf43f744ba66e02ada450297e8ad30b68dd4e"
        },
        {
          "identity": {
            "id": "4c7f80dd-8cf9-538e-8246-40d0824288c7"
          },
          "contentHash": "aed0139d455037ffdf10e9620e3141358caa102277463d33dfd5afa6e36a20ff"
        },
        {
          "identity": {
            "id": "d8309a52-86a7-5ec3-98fb-c6951156c81d"
          },
          "contentHash": "98dc4f8aec518575f5ea2a45c9e630523baca3e7e8624edfb8165fc56ada2cb4"
        },
        {
          "identity": {
            "id": "45768228-57c0-52b4-acab-15d2f2b4cf9f"
          },
          "contentHash": "c2187ba31b9a3d94e90cf0b89b3bf13ecfa7b1df4871b400ccf6c0127df38e09"
        },
        {
          "identity": {
            "id": "8fff62be-6288-5a95-8381-386fcd5f1e42"
          },
          "contentHash": "fa31d49b523a7abbe338a0e50ff7d96dfb2644fd1d3d9ff09e84c1e1588ba60c"
        },
        {
          "identity": {
            "id": "388d9565-f8e8-5cb2-9e21-4b9d9d3ca8da"
          },
          "contentHash": "10cbbcc66dd05ce16b008434933748cfaa1e4bbefab6461d225022b2d9cd275f"
        },
        {
          "identity": {
            "id": "a6366c7b-79cb-594a-86c4-3be3c2c3beb7"
          },
          "contentHash": "720c66514fd7dd1eab62c640804792e38656e24b2fb75f50ae7b28c973a20fa4"
        },
        {
          "identity": {
            "id": "beb4c4dc-7eb9-5deb-8cf4-dc1cf873cb60"
          },
          "contentHash": "1725d8cb9546c6b46cbb63bc84a36fa9546df9e85e49fe1aada94e490c0f72e7"
        },
        {
          "identity": {
            "id": "7a585c93-4a92-5935-9f32-f059aa9da331"
          },
          "contentHash": "55798f3c0d6f5e5ef67904ba93b00d80881176bf0b8dc46ab7d345a184c671ec"
        },
        {
          "identity": {
            "id": "b739b41c-ce67-52a0-8699-80dd61026f0e"
          },
          "contentHash": "6fabd2d20d7cdae8706561acf5137989df14349d300d29a400395ac988567f20"
        },
        {
          "identity": {
            "id": "f9d18c7a-663b-5df2-9e61-96faf55c7635"
          },
          "contentHash": "d5b5a5929869b0a2467c9ab32c8b19229a3e26e561bd5353a0cbf8a91da3cb97"
        },
        {
          "identity": {
            "id": "06c0cee2-cc0d-5ba6-b190-418ce13f9b54"
          },
          "contentHash": "4753477ba197f0375c5337867de643b0db8b29eef43478a6043a3ff704611a57"
        },
        {
          "identity": {
            "id": "7ab7ee90-0ce9-52a6-ba04-abf81beeb5ac"
          },
          "contentHash": "6065f10f63a1b9aefa7409641e0a4297d878968e3edd189d42789a6a5c7aa12f"
        },
        {
          "identity": {
            "id": "12a3302b-9c33-5d42-b6cf-987ee10d6fb0"
          },
          "contentHash": "8ef43c3c1fa7c59568d0fe61ba3f36106cb2aba170550ab843a257b737690dcc"
        },
        {
          "identity": {
            "id": "dd3c3a84-c93c-59d0-951c-93eeeac74895"
          },
          "contentHash": "604be43b3998f9a0b9f0a871b0e354c05891ef011e91d1e0da365a772a54f36d"
        },
        {
          "identity": {
            "id": "74b01a8e-f45b-50b5-985a-f199c652f9f1"
          },
          "contentHash": "751d673b3d287bcc9bf698f9af971bda1819029dc9e23b4be4a97b0dc9599e41"
        },
        {
          "identity": {
            "id": "b1e11ab0-311f-507c-a240-a09a706f5321"
          },
          "contentHash": "068a0ed2f5aea4a6468a944e13db1c3ef35bbb312cfd354ac84ea91fd4490d38"
        },
        {
          "identity": {
            "id": "d57630ad-f59a-52a4-9191-e7c0ea787fdc"
          },
          "contentHash": "ace5c29a7a68638422e56456d7cbfa908d8da203969febe9191cc397d490262c"
        },
        {
          "identity": {
            "id": "a7828668-1ddc-576d-b814-2a164b4fae9d"
          },
          "contentHash": "8a216b0c4e5b0827e0192facde3423a738885d8d64abe19df598b2e7be9ca556"
        },
        {
          "identity": {
            "id": "ff36babc-e76b-5ab2-986f-65b45feaf378"
          },
          "contentHash": "b2405f474826e1fee3302253b143d841def643dfcaf8f03c992935be2c378c60"
        },
        {
          "identity": {
            "id": "02cd71ba-79fb-5ddc-84c9-5bf4b4f34504"
          },
          "contentHash": "67eadb19007c43990cedf3b5f32488ad0c2fd4cbc9f26676879d5797016fceba"
        },
        {
          "identity": {
            "id": "8dcae170-7428-5283-9cd0-bff4450708b8"
          },
          "contentHash": "dff9feb6defdc19edda3bf41f17dc62505519fa66b9f72afeccde808885984e1"
        },
        {
          "identity": {
            "id": "73299d6e-43e0-5681-914d-945899ece740"
          },
          "contentHash": "e692045589c994c6ce8a8e6673c924d6ddae6153dbaa9e11fdba06760afaab00"
        },
        {
          "identity": {
            "id": "ce338fea-8551-5e07-993e-880157743a60"
          },
          "contentHash": "93fcb2e4082227a29322c3b7c183079d3c3c97839d2e3aebceb6aeb2a3e167d5"
        },
        {
          "identity": {
            "id": "df47bfb7-31f2-5678-8cad-036307e25cc1"
          },
          "contentHash": "9faf525eccde3349ae96318d24a172eb5e6b537f89b3416ecff7785c2a140e48"
        },
        {
          "identity": {
            "id": "a122b877-0cf1-5c43-86a0-6b4015657f13"
          },
          "contentHash": "7f9245e7a056cd433c18c7d23991b9339adc2243df9e9cea21d1085f83455936"
        },
        {
          "identity": {
            "id": "70721d79-da49-5bea-950d-1649bc873af4"
          },
          "contentHash": "73e92b3f5f8078e2e1964c6104d9003f84e9f5c2a7534b938655f869300e768d"
        },
        {
          "identity": {
            "id": "71eee88c-d665-58c0-8c42-f396c0ced036"
          },
          "contentHash": "47cbcb73c64ea48319de8c12aa5e27fa9ec88acb378f0fd9305f2167d5a769d5"
        },
        {
          "identity": {
            "id": "760cf073-697e-5409-9525-3d8514fbf041"
          },
          "contentHash": "1363eb1d58e4366334afd3337a22ddbd070d402f2aa826b69c8008f320ec6b2d"
        },
        {
          "identity": {
            "id": "81f65c00-19e6-58ce-9113-b6ec7a3ef746"
          },
          "contentHash": "17e27b346bc57e927589967b927b4be5336e009988ce68616db199d70f568bf2"
        },
        {
          "identity": {
            "id": "985eaa46-4827-5fb1-99b3-38f6ec2f584e"
          },
          "contentHash": "3957b5879e423ca35dfc3a47ba13f4c75553350b62771c3c8ced941c71dc5211"
        },
        {
          "identity": {
            "id": "43698c86-93bd-593a-8b49-16fc6d2063af"
          },
          "contentHash": "5503d4f3ee17f29d911e2c2eeac6b55170a9cb8b5b656752746efef0ae1e1a30"
        },
        {
          "identity": {
            "id": "458d8bee-470f-540b-81a6-eaee04205258"
          },
          "contentHash": "d277bd4c909b421233580da0e4aa7d9219e16c3783808c636c32c438a2402cd6"
        },
        {
          "identity": {
            "id": "78a1778a-4ad3-5a39-bc0e-7c7d7abd7f5d"
          },
          "contentHash": "378e0e9fc5cdd86d187fe12ea4d320d1520bf4843364048d1802ed2d7e9ec7a5"
        },
        {
          "identity": {
            "id": "15055c2b-fcbf-50fc-81e8-8fd1dc03dbb0"
          },
          "contentHash": "918cae9d9d0399dccdc8f404e7493c0dd9671961d546ceb7c626a92e136ca903"
        },
        {
          "identity": {
            "id": "ec3c905d-ecbd-5e35-8dd9-e514f995e3c1"
          },
          "contentHash": "5cd1424c27cca57e4d3f517c3ed45eafdcbb33d5b7de4d4578c976b9cbb95ea4"
        },
        {
          "identity": {
            "id": "2686d532-0e91-50ea-8666-107580f797fb"
          },
          "contentHash": "6040d3a06b75093e5f60eaf07e7b62a1b0b39c5945eb4b7e0179131b4176fd17"
        },
        {
          "identity": {
            "id": "35e0a4b7-eff2-55f5-a13b-1c6c800d1781"
          },
          "contentHash": "280f2a8b518305b43dcadd9726cf8c47531dc4d2cc751bf85d5a6c4a00675cc6"
        },
        {
          "identity": {
            "id": "8ccbf09e-0c25-5dc6-8812-fee8f79505f1"
          },
          "contentHash": "28adaec73e9741d01db23ee2fa63d90ea2472d438465e9d593718af71cf02946"
        },
        {
          "identity": {
            "id": "33dfe796-1993-5833-bdcb-7e0f7d819318"
          },
          "contentHash": "57b94bca498c56e61f46decb16d7380c512e2e3e1ca8f1319677d5e321f3bfcb"
        },
        {
          "identity": {
            "id": "74956566-2f4e-5379-b371-f7978f24d782"
          },
          "contentHash": "7299571590f4599820de5653a5c698a88b16b0558e610702b85d7df6d343a8e6"
        },
        {
          "identity": {
            "id": "68c28b80-c03d-5495-afdc-c00bc0189c26"
          },
          "contentHash": "3ea0b964d6f06029ca06926ef1f690eb58fb749ba4b203d7e424ed1be2c92cca"
        },
        {
          "identity": {
            "id": "14512d63-722e-5f07-b3c6-8d0dd0e68651"
          },
          "contentHash": "f3372639cc340f7205929cf0deb4bfc6530b8a03846d1d90c648d4c84a2a7d5c"
        },
        {
          "identity": {
            "id": "d2a9bb29-f13e-5cb0-b3d6-2e9591748770"
          },
          "contentHash": "6473cf142f3f61dbbc0370051d2ac2b08e905356e2d28c677626204698a3e7a0"
        },
        {
          "identity": {
            "id": "588e789a-3ea1-57db-a574-9734ad0fae89"
          },
          "contentHash": "dbd3e6eae207a5ba357de4f6539ffafc9fecf24c6e13485e67d24ebeddb73e56"
        },
        {
          "identity": {
            "id": "2f8fa818-af21-5077-93de-087d4670f481"
          },
          "contentHash": "d9ced95f1c6cad7aa318a45e302a2b828cd7c58ed770b7e168c117abb844b7fd"
        },
        {
          "identity": {
            "id": "f45bd8d6-35b7-5845-87c2-a4aeeb29923b"
          },
          "contentHash": "836a87e95ecee9a0eaacb7b23145a95395bf16edff8ea5bf82a4c5ee696939de"
        },
        {
          "identity": {
            "id": "99674a5d-a226-5c71-863b-dad8afc78be8"
          },
          "contentHash": "5dc29c183a7ddfd667045572a3a522b38571e7365018d8836e69eda16f8b9b02"
        },
        {
          "identity": {
            "id": "24579444-3a28-58de-b57c-670a2961cf61"
          },
          "contentHash": "e2bd9352ab887d794e93e3043d86496d8dc6000c7d0267033cd5d7ad449cc870"
        },
        {
          "identity": {
            "id": "672f9b51-e3a7-5c9c-a22b-1f5b3c4c174c"
          },
          "contentHash": "9352e1318c977d4858cd5fb2457a698e9eae11eba604803faf043a184d0fc8e2"
        },
        {
          "identity": {
            "id": "af831713-88a3-50a3-b94d-d0de288073b2"
          },
          "contentHash": "3673f4e8c14b2effdfae08c6cc077794e4e415d1e51af442ee106a6869eee024"
        },
        {
          "identity": {
            "id": "96a76c01-8209-5c21-b8c2-efd9a3b07814"
          },
          "contentHash": "b610834d30b728bb214bc58c4b6392a025e105b651baf4e3dbf814f9396f5651"
        }
      ]
    },
    {
      "table": "tournament_participant_sets",
      "identity": [
        "id"
      ],
      "columns": [
        "category_id",
        "frozen_at",
        "frozen_by",
        "id",
        "idempotency_key",
        "invalidated_at",
        "organization_id",
        "participant_fingerprint",
        "reopen_reason",
        "reopened_at",
        "reopened_by",
        "season_id",
        "status",
        "tournament_id",
        "version_number"
      ],
      "columnKinds": {
        "category_id": "scalar",
        "frozen_at": "scalar",
        "frozen_by": "scalar",
        "id": "scalar",
        "idempotency_key": "scalar",
        "invalidated_at": "nullable",
        "organization_id": "scalar",
        "participant_fingerprint": "scalar",
        "reopen_reason": "nullable",
        "reopened_at": "nullable",
        "reopened_by": "nullable",
        "season_id": "scalar",
        "status": "scalar",
        "tournament_id": "scalar",
        "version_number": "number"
      },
      "ownership": {
        "column": "organization_id",
        "values": [
          "a5627c00-6b91-59b8-a366-455261e6e8de"
        ]
      },
      "rows": [
        {
          "identity": {
            "id": "9d46d27c-4ae3-56a5-8a1e-a48b739117cd"
          },
          "contentHash": "26e84f2afd76ee5f60f9487a952dda3313eaa45eb703668aa9f742ccf296151f"
        }
      ]
    },
    {
      "table": "tournament_competition_participants",
      "identity": [
        "id"
      ],
      "columns": [
        "category_id",
        "frozen_at",
        "id",
        "organization_id",
        "participant_set_id",
        "pot_number",
        "season_id",
        "seed_number",
        "snapshot_name",
        "snapshot_primary_color",
        "snapshot_secondary_color",
        "snapshot_shield_path",
        "snapshot_short_name",
        "status",
        "team_entry_id",
        "tournament_id"
      ],
      "columnKinds": {
        "category_id": "scalar",
        "frozen_at": "scalar",
        "id": "scalar",
        "organization_id": "scalar",
        "participant_set_id": "scalar",
        "pot_number": "nullable",
        "season_id": "scalar",
        "seed_number": "number",
        "snapshot_name": "scalar",
        "snapshot_primary_color": "scalar",
        "snapshot_secondary_color": "scalar",
        "snapshot_shield_path": "scalar",
        "snapshot_short_name": "scalar",
        "status": "scalar",
        "team_entry_id": "scalar",
        "tournament_id": "scalar"
      },
      "ownership": {
        "column": "organization_id",
        "values": [
          "a5627c00-6b91-59b8-a366-455261e6e8de"
        ]
      },
      "rows": [
        {
          "identity": {
            "id": "8bb07b14-7628-53c9-87e0-077a5f8b954c"
          },
          "contentHash": "9b34d62fcf80e259ac5d04439f4a6b103d2546c98d98cbe1ad964e94779672fc"
        },
        {
          "identity": {
            "id": "d7814279-6d96-54e6-8a9d-dbfc7fd1bea6"
          },
          "contentHash": "d1c1d26167ac74ee43ba268f065baf7f9d34a5cd50bc9ee4ed25a11eac0954cd"
        },
        {
          "identity": {
            "id": "993369e6-b061-5cd0-be5b-718510b6b993"
          },
          "contentHash": "f2c4a3f8a5b05fcb60db3a18f2687f2bfbd575da549e2d7c1c3aa4458ba9f421"
        },
        {
          "identity": {
            "id": "dcae962c-9ee6-58ea-8879-50b90f4d6b6a"
          },
          "contentHash": "cfdb40a03c01bd0f9f733d21b609c505d2cc2e989160701d7ce568f1ed7de0a0"
        },
        {
          "identity": {
            "id": "81f678ee-6c55-5690-b32e-5fc82db5ab3d"
          },
          "contentHash": "503ca977e8ed789b88e69e24ccdc2d57be8dd4b51675a7faf58fde760e0ce854"
        },
        {
          "identity": {
            "id": "04b474c0-9749-5761-970c-022be84c0e7a"
          },
          "contentHash": "146a4771993ac9fdf39e47f2e03352e07cdcfd77b0540a256ac7e65cbc0ac699"
        },
        {
          "identity": {
            "id": "a94b75ef-3f02-53e0-bea2-63851d33a1a3"
          },
          "contentHash": "c3d0f6ca375dc1ec81f7cd2f1fcbba407b384086635fc93179d889d2a2d8b126"
        },
        {
          "identity": {
            "id": "d876f66c-4e39-5daa-ba2f-8f03a2674462"
          },
          "contentHash": "83cca3ae4af7ce3f4c119b04b5e6228fbc9f0b1810edb35b6535cab8c7df73c0"
        }
      ]
    },
    {
      "table": "tournament_fixture_versions",
      "identity": [
        "id"
      ],
      "columns": [
        "archived_at",
        "category_id",
        "configuration_snapshot",
        "created_by",
        "generation_method",
        "id",
        "idempotency_key",
        "invalidated_at",
        "organization_id",
        "participant_fingerprint",
        "participant_set_id",
        "published_at",
        "season_id",
        "seed",
        "status",
        "superseded_at",
        "tournament_id",
        "version_number"
      ],
      "columnKinds": {
        "archived_at": "nullable",
        "category_id": "scalar",
        "configuration_snapshot": "scalar",
        "created_by": "scalar",
        "generation_method": "scalar",
        "id": "scalar",
        "idempotency_key": "scalar",
        "invalidated_at": "nullable",
        "organization_id": "scalar",
        "participant_fingerprint": "scalar",
        "participant_set_id": "scalar",
        "published_at": "scalar",
        "season_id": "scalar",
        "seed": "scalar",
        "status": "scalar",
        "superseded_at": "nullable",
        "tournament_id": "scalar",
        "version_number": "number"
      },
      "ownership": {
        "column": "organization_id",
        "values": [
          "a5627c00-6b91-59b8-a366-455261e6e8de"
        ]
      },
      "rows": [
        {
          "identity": {
            "id": "df29a76e-eb45-5922-a937-a94f11cf0402"
          },
          "contentHash": "a168a48472a2271aba2aa533a8d403801deab0eb5097854c93f6e3abcef469b5"
        }
      ]
    },
    {
      "table": "tournament_phases",
      "identity": [
        "id"
      ],
      "columns": [
        "category_id",
        "configuration",
        "fixture_version_id",
        "id",
        "locked_at",
        "name",
        "organization_id",
        "phase_type",
        "sequence_number",
        "status",
        "tournament_id"
      ],
      "columnKinds": {
        "category_id": "scalar",
        "configuration": "scalar",
        "fixture_version_id": "scalar",
        "id": "scalar",
        "locked_at": "nullable",
        "name": "scalar",
        "organization_id": "scalar",
        "phase_type": "scalar",
        "sequence_number": "number",
        "status": "scalar",
        "tournament_id": "scalar"
      },
      "ownership": {
        "column": "organization_id",
        "values": [
          "a5627c00-6b91-59b8-a366-455261e6e8de"
        ]
      },
      "rows": [
        {
          "identity": {
            "id": "a05ccc3d-7ce4-5a01-9bae-844ccce0b87a"
          },
          "contentHash": "fdf226343a19432c645f1299ed703f0413bdcae3687ff223e8aeefa98df39879"
        },
        {
          "identity": {
            "id": "a06154da-e299-57a9-84b3-3492c6ed31ac"
          },
          "contentHash": "02b70255dd52658488415af6360a63dd17e53acb2707e73a21ec9b8b8f522b07"
        },
        {
          "identity": {
            "id": "7a8c26a8-40e0-50ab-a26e-3c09db6c6507"
          },
          "contentHash": "df4a6f66d1667f72c1e04b03a33d374a8024cf09c7a5fb4e0edf94adb2034498"
        }
      ]
    },
    {
      "table": "tournament_rounds",
      "identity": [
        "id"
      ],
      "columns": [
        "category_id",
        "ends_at",
        "fixture_version_id",
        "group_id",
        "id",
        "name",
        "organization_id",
        "phase_id",
        "round_number",
        "sort_order",
        "starts_at",
        "status",
        "tournament_id"
      ],
      "columnKinds": {
        "category_id": "scalar",
        "ends_at": "nullable",
        "fixture_version_id": "scalar",
        "group_id": "nullable",
        "id": "scalar",
        "name": "scalar",
        "organization_id": "scalar",
        "phase_id": "scalar",
        "round_number": "number",
        "sort_order": "number",
        "starts_at": "nullable",
        "status": "scalar",
        "tournament_id": "scalar"
      },
      "ownership": {
        "column": "organization_id",
        "values": [
          "a5627c00-6b91-59b8-a366-455261e6e8de"
        ]
      },
      "rows": [
        {
          "identity": {
            "id": "86afe829-3b5c-5cfe-b8e5-9763a85e7169"
          },
          "contentHash": "1feec0e9cf7282d42785fe6f0107569ac0a0f9baafffb3164ddb9d24342141c4"
        },
        {
          "identity": {
            "id": "a5515963-ca1a-5943-8e57-6564db9b2707"
          },
          "contentHash": "caff2994ee1a186b803a0b367e5cf7e2b65c4d89f2a6209106743896f79eac1d"
        },
        {
          "identity": {
            "id": "19d67c3b-a7c2-5fd3-8ac9-f2f45a9cce47"
          },
          "contentHash": "4f477db74b678a53c1c058b84411396149567fc4219fefe800a0ca1573938e03"
        },
        {
          "identity": {
            "id": "ee45e687-86fc-5462-b12f-ae27283d3362"
          },
          "contentHash": "873ffdd2b28c63c6bb08c714f39a920eeb63688e7a7ffc0a6d382a443730e5ce"
        },
        {
          "identity": {
            "id": "15550c55-af3c-5127-82ab-4fe099d8a2dc"
          },
          "contentHash": "6992760ac3a51cbbcc9ca0d89f911c7a16d44f0c06d17915fa0507b8313262b8"
        },
        {
          "identity": {
            "id": "8c74555e-e3ea-53e1-bab2-bf4641132d06"
          },
          "contentHash": "3675335b3f01d971e2bc553057fa8e7539fd6173807ed8b8ddba78523c781346"
        },
        {
          "identity": {
            "id": "2d24ecfa-8914-5e14-aeb4-6539e58b78cf"
          },
          "contentHash": "1eb0916eb502ebdc4145c0f60d53438e4a1be6523a0bb5d3f6ebc485243382fa"
        },
        {
          "identity": {
            "id": "e5dd819a-4db2-5a3e-8454-674016ef5727"
          },
          "contentHash": "c846bff42f6634258dfcb15cde5687d3651f8bdb1ef33028e14eba9ee856f1f7"
        },
        {
          "identity": {
            "id": "f48df1d2-caa1-524d-a5f6-821567bb4e79"
          },
          "contentHash": "aab585d659ade1be6933abe883711c971761f0069d54536e5d2063d45b13ee82"
        }
      ]
    },
    {
      "table": "tournament_matches",
      "identity": [
        "id"
      ],
      "columns": [
        "away_participant_id",
        "cancelled_at",
        "category_id",
        "court_id",
        "created_by",
        "duration_minutes",
        "fixture_version_id",
        "group_id",
        "home_participant_id",
        "id",
        "leg_number",
        "match_number",
        "organization_id",
        "participant_set_id",
        "phase_id",
        "postponed_at",
        "round_id",
        "scheduled_at",
        "season_id",
        "status",
        "tie_key",
        "tournament_id",
        "venue_id"
      ],
      "columnKinds": {
        "away_participant_id": "scalar",
        "cancelled_at": "nullable",
        "category_id": "scalar",
        "court_id": "nullable",
        "created_by": "scalar",
        "duration_minutes": "nullable",
        "fixture_version_id": "scalar",
        "group_id": "nullable",
        "home_participant_id": "scalar",
        "id": "scalar",
        "leg_number": "number",
        "match_number": "number",
        "organization_id": "scalar",
        "participant_set_id": "scalar",
        "phase_id": "scalar",
        "postponed_at": "scalar",
        "round_id": "scalar",
        "scheduled_at": "nullable",
        "season_id": "scalar",
        "status": "scalar",
        "tie_key": "scalar",
        "tournament_id": "scalar",
        "venue_id": "nullable"
      },
      "ownership": {
        "column": "organization_id",
        "values": [
          "a5627c00-6b91-59b8-a366-455261e6e8de"
        ]
      },
      "rows": [
        {
          "identity": {
            "id": "74db14eb-e6cd-5009-ad24-4ae627fba042"
          },
          "contentHash": "f5fdfb33fd838f57182739bdacea22556ab742b53b7ebe7c526ae614a3414042"
        },
        {
          "identity": {
            "id": "9a1da1b4-fd09-5207-a7a3-f1adf63cc718"
          },
          "contentHash": "2c2d8262f8d6846ddae68dc8fa4fd5d1aa96d239b173745a1e0ee6a8ae2714f4"
        },
        {
          "identity": {
            "id": "301d7a65-0d0b-5307-afec-efdf693a9458"
          },
          "contentHash": "ed4e1efbab8ae37d76a22f6ba79ab3469346c802fb91a183ef0a0ed4d0d06553"
        },
        {
          "identity": {
            "id": "d4d07438-b710-53ea-983a-074c5c7bdc9f"
          },
          "contentHash": "730669e1564d7221916f05e7471f50979b776a87f8cc7f77032bb780157916bf"
        },
        {
          "identity": {
            "id": "ed99891f-c064-57d8-b79c-f4903d3949d0"
          },
          "contentHash": "78344358ada86a07bc3ebd2eac7a50c1450a8dcda4e9701759ef7edafda68447"
        },
        {
          "identity": {
            "id": "568a11ef-96dd-54a6-9b39-721d12418d8f"
          },
          "contentHash": "ef0186d42b48b042563a111d87c0037b28633abe13cf4a7c69a14d531d9ac8d0"
        },
        {
          "identity": {
            "id": "3f20ccbe-b87a-5efa-8c8a-0e3e2ea15fdd"
          },
          "contentHash": "515afb7edc81e66904d92461208f7b51b1965421b49cd82001aca81195eb7ada"
        },
        {
          "identity": {
            "id": "92864fc5-893a-561b-bd65-a8bf710cee3f"
          },
          "contentHash": "80edbfa6dc6ed1d5a39d63cdcb400eead5a598b6e00d0f259bffeef2c016aadd"
        },
        {
          "identity": {
            "id": "be47af0e-32fb-5e5d-bfc2-65ba1a6af25f"
          },
          "contentHash": "11649139a490eaefa98f0f80ded111c6927883de8ec1927bffb429714efc2aa5"
        },
        {
          "identity": {
            "id": "12a03195-cfb3-5c91-81d3-b07efecf59f0"
          },
          "contentHash": "67b15568389bbe23e274a57e34d3aacfe66df3cff26a4384404cb4ed9f169c4e"
        },
        {
          "identity": {
            "id": "eed67a34-4b93-5908-bc49-95b474640126"
          },
          "contentHash": "def28858dbf61edb621ac12ef6c0d80759371a0906587ef45704cd7db86c12f2"
        },
        {
          "identity": {
            "id": "d5442846-db2c-58ad-8822-31eb28d93ac5"
          },
          "contentHash": "9f267ef38f659c6600e5a2f1c304f32c3809cad87c064ec2d0f4a1d4a805c641"
        },
        {
          "identity": {
            "id": "680573bf-00ce-56e8-be38-e038e05df5e0"
          },
          "contentHash": "a54e061595e58234021a432139458e2f89d86eb72a1f217b97412dccac204e71"
        },
        {
          "identity": {
            "id": "cba10ae3-72cf-5677-807f-8929ceddfbc6"
          },
          "contentHash": "c28bcd403fcc0165bb5180419ca2357aa2487d5e8b753931eccf53dacd683af1"
        },
        {
          "identity": {
            "id": "94a35848-578c-5e03-84ca-ca7178e6a14e"
          },
          "contentHash": "88ef2a4cace08d81adb0af2162387cc573dddab9631b5bc27711536569201889"
        },
        {
          "identity": {
            "id": "a3b1b9c4-9de5-5b10-960a-629cae6f8685"
          },
          "contentHash": "3c7602ebdbe2aa0494109384103402d462b64b074ae1bad4ad6652560c4c46b2"
        },
        {
          "identity": {
            "id": "b51f68f8-91d1-5680-a32a-d0a97eea3f82"
          },
          "contentHash": "9ca755d0448963f7e116fd4de82293498b1609308cebb72583d7c8e5f0e10c3a"
        },
        {
          "identity": {
            "id": "12e99c39-081e-5b2a-9445-00ce33e7e609"
          },
          "contentHash": "3cf7fbf4f024147df6133753886df595a131a76b264f2f707c314c5af0536e99"
        },
        {
          "identity": {
            "id": "d9499776-e219-5da1-aa8a-b635ea2a1470"
          },
          "contentHash": "21f5721fdaa601597c185f8cbc305a2651e9e36a44b91c8ff041e1bdc04acebb"
        },
        {
          "identity": {
            "id": "b5112567-e198-5879-9261-5645181c96ad"
          },
          "contentHash": "87f4d5e9bac827626efb0990caf9d0a981411b45bd7a09f77c49387b7d70489b"
        },
        {
          "identity": {
            "id": "204c8d5e-9f82-502f-9ded-af29ee238b27"
          },
          "contentHash": "0260552942311392950b070a86ab99d51b9f438263a13f66e70e2279b208da39"
        },
        {
          "identity": {
            "id": "132dde15-270c-5d50-a0ea-11848597364f"
          },
          "contentHash": "50c525f21017600001773c79514755c9a278266a78fda61fb79db519ba33681e"
        },
        {
          "identity": {
            "id": "1198633b-220a-5ea9-bd04-61053163356c"
          },
          "contentHash": "7e070471526a4535d871d2c34b380387c574a267eaa3c4646d37db6f69a5879c"
        },
        {
          "identity": {
            "id": "f6ae94e8-ed48-538a-8d57-fc0073cad114"
          },
          "contentHash": "e390ad3a9a3f90d47baf5c3f0598677f31241c08b575abcc287d3e103b1876a4"
        },
        {
          "identity": {
            "id": "57223170-0c10-5148-8d90-533466c3b022"
          },
          "contentHash": "911db6bc31a053e054604033f1b3261ab572387401dc3d454ee66862c6b4b55a"
        },
        {
          "identity": {
            "id": "f1f66e77-b61a-5b5f-b52f-9b4aec54b148"
          },
          "contentHash": "9ef299c3d073e0c12166a9740fda30b5dda3f601ad3e1190546cb3e47666462d"
        },
        {
          "identity": {
            "id": "6f714003-5356-5325-98b8-c6d984150279"
          },
          "contentHash": "3fc58e2e7f643a79ad1a055e13404e5526508479fc3fd26bf650e0fab1b84b37"
        },
        {
          "identity": {
            "id": "1cd552e7-f2b1-5c4f-83b1-e96f1379806e"
          },
          "contentHash": "4916f34fc911f63d2a0c25a8b504e9535954b504ad37c449b0d71a0b34f000a6"
        },
        {
          "identity": {
            "id": "01449daf-a4ed-5627-b8f4-ecc85c7b64d2"
          },
          "contentHash": "65e349c59abfad69ecb291aea09a6bf282bfeeca597510a41864cac1e6b23425"
        },
        {
          "identity": {
            "id": "e59f1807-6a0c-5367-8f78-a4961b014c52"
          },
          "contentHash": "9a047b8f768a8df730aef41f4fa89d0151a12a09831c61c075e8aec6f6755e52"
        },
        {
          "identity": {
            "id": "4117bc00-8c42-5d99-b12a-9ea65c84a612"
          },
          "contentHash": "8c52562298690082f950da755f2d484bf35a2cfe1bf74ba9692c6c0b28142f91"
        }
      ]
    },
    {
      "table": "tournament_match_operations",
      "identity": [
        "id"
      ],
      "columns": [
        "away_team_entry_id",
        "away_team_snapshot",
        "category_id",
        "closed_at",
        "fixture_version_id",
        "home_team_entry_id",
        "home_team_snapshot",
        "id",
        "match_id",
        "match_snapshot",
        "match_status",
        "notes",
        "official_at",
        "official_by",
        "opened_at",
        "opened_by",
        "operation_version",
        "organization_id",
        "phase_id",
        "round_id",
        "season_id",
        "source_operation_id",
        "status",
        "submitted_at",
        "submitted_by",
        "tournament_id",
        "validated_at",
        "validated_by"
      ],
      "columnKinds": {
        "away_team_entry_id": "scalar",
        "away_team_snapshot": "scalar",
        "category_id": "scalar",
        "closed_at": "scalar",
        "fixture_version_id": "scalar",
        "home_team_entry_id": "scalar",
        "home_team_snapshot": "scalar",
        "id": "scalar",
        "match_id": "scalar",
        "match_snapshot": "scalar",
        "match_status": "scalar",
        "notes": "scalar",
        "official_at": "scalar",
        "official_by": "scalar",
        "opened_at": "scalar",
        "opened_by": "scalar",
        "operation_version": "number",
        "organization_id": "scalar",
        "phase_id": "scalar",
        "round_id": "scalar",
        "season_id": "scalar",
        "source_operation_id": "nullable",
        "status": "scalar",
        "submitted_at": "scalar",
        "submitted_by": "scalar",
        "tournament_id": "scalar",
        "validated_at": "scalar",
        "validated_by": "scalar"
      },
      "ownership": {
        "column": "organization_id",
        "values": [
          "a5627c00-6b91-59b8-a366-455261e6e8de"
        ]
      },
      "rows": [
        {
          "identity": {
            "id": "2ef07000-caf4-5450-b292-1e439efa6c31"
          },
          "contentHash": "83646333771093475ee4c8ea52108748db02d5aa1e24b19af18c628671f3a572"
        },
        {
          "identity": {
            "id": "239e703a-8ccf-5bfe-8fc0-cd32242cdcab"
          },
          "contentHash": "3f618bef2652465b4ff9571f9212d2c1d8b42b5a71612a3b74989b0092fa32fa"
        },
        {
          "identity": {
            "id": "27a57280-6c4a-50d5-82ef-d6716634ec10"
          },
          "contentHash": "dcc74b5b4bd69fe221e059d22e5b0433f764632f86523ef0ad1a75a3b6ec975e"
        },
        {
          "identity": {
            "id": "13926915-cf0f-5b41-8216-599d2838988e"
          },
          "contentHash": "ea2abc691cb13caa0c12c8e8e116ddf4436eeb626393eb23a86ba928d63d066d"
        },
        {
          "identity": {
            "id": "a1414c8f-f8f5-57a4-875c-96006a9ba3e8"
          },
          "contentHash": "b9917d3cdc64f359bf140e85550d2a381b038b3f05685085454907770673bd45"
        },
        {
          "identity": {
            "id": "d32166a5-023b-5763-ae4f-43de66248ab6"
          },
          "contentHash": "778d2bc2f998a7356d2afd89cc80b0d185668bd283c61427f421e261e33675a5"
        },
        {
          "identity": {
            "id": "cef0c5ce-baf7-53da-a915-a439ad513a7b"
          },
          "contentHash": "e495c03ace728d8f698d63101c438db57ef4780e64015c0ad24bd3e157bd82cc"
        },
        {
          "identity": {
            "id": "195bd909-8a50-5ccb-8091-d2251d161113"
          },
          "contentHash": "c33f57505d07b1ede5442a8862de4b3c04a37f7005f90fc027385d6d737f5ffe"
        },
        {
          "identity": {
            "id": "df821b06-857d-59d1-a47a-bdf58cf41f4b"
          },
          "contentHash": "badceab98a68197d8bb6ac6ebd8efb2af74227ed1932a6c28f1e1bef00284e17"
        },
        {
          "identity": {
            "id": "dedfd4a8-15f8-5cd9-82aa-5c3a2ff06eae"
          },
          "contentHash": "f9cf96f079a2101ec612b56469c0b90e568722989f8ccf2dd39e64a1d7abb705"
        },
        {
          "identity": {
            "id": "e71ecc2e-feed-59f2-9070-39eda2305672"
          },
          "contentHash": "d58b124d6cdb27589d3a925c13c32bef1bbe0b0b28ca047b09a7afee26c2620b"
        },
        {
          "identity": {
            "id": "07a93e19-c506-5011-9c8b-7a7251da9099"
          },
          "contentHash": "4946cfa3ce5a6a91d850cfc2656a637e56b3e160f5403b2894ed72641c06fa03"
        },
        {
          "identity": {
            "id": "32f1c991-a8b8-5ea5-aa60-49f5dbb65371"
          },
          "contentHash": "9e4c36ea6de37dd360c3f6a8655fc434f86112cbc5b4bd4430ff034595de52ed"
        },
        {
          "identity": {
            "id": "dac34595-2a42-597b-b849-4a3dbdc1fc3c"
          },
          "contentHash": "6fedd9448a2737cffc30189463ac8558f2434b1ae85f66eabf839e55a640fb50"
        },
        {
          "identity": {
            "id": "192b970b-af32-5f08-b54c-12536d4f1d6c"
          },
          "contentHash": "96edf8d1d9a98faea65533ec643888740fedc6c24992b50f3f7aa25b812ee74a"
        },
        {
          "identity": {
            "id": "043bd394-a65d-5cf7-9e56-b0e61b800711"
          },
          "contentHash": "352c3922d73c04611dab94db86f6f08b05cddf814e909cdfe7cc28c1488e0e07"
        },
        {
          "identity": {
            "id": "d837c669-e47f-51ca-9e32-5d3d89816af3"
          },
          "contentHash": "27641f46b57008bdf5ac0a9add684df5da6c583a725eecf005704d17a84e03c3"
        },
        {
          "identity": {
            "id": "a8e3cb20-c1af-5a19-9ce1-1849506c4374"
          },
          "contentHash": "f3ed23cb72525d5085d8841bb320867022401ca58316bbe48f7f9146de2d26e4"
        },
        {
          "identity": {
            "id": "3ad3afe2-8688-5573-9726-408a6e012760"
          },
          "contentHash": "6383bb5282ab2a467048e846011b18e45d489bb5f2538906b149896844cbfe4d"
        },
        {
          "identity": {
            "id": "79a6f2a2-b3a3-5529-accf-ca27e8625336"
          },
          "contentHash": "fabccb2d17798c0cca2ba652acc5df8bfa2686c6a43528a0941861fb31c96a48"
        },
        {
          "identity": {
            "id": "d6904074-ba15-53a0-9901-5167f7a8bff5"
          },
          "contentHash": "2ce15449a7d2046ec4a14acbd08b2cdb705c4e5122813cd6529acaceac867db2"
        },
        {
          "identity": {
            "id": "027af416-08ef-57e0-91ec-ea11c8ba2696"
          },
          "contentHash": "78758e22b06857d216b5aba20460125e7b3314948444b3ddad2e6897269a351c"
        },
        {
          "identity": {
            "id": "7bf7a2f6-f063-52a7-912c-4b409cb4556d"
          },
          "contentHash": "ba6746073261cbe785963bfb87dbe9c4eee8245090cd6b98347adb31e7510304"
        },
        {
          "identity": {
            "id": "b0fba4b3-55d4-5776-973e-e84600211224"
          },
          "contentHash": "a6daa5e0709e5555d28dbf6f947d8a338fc9bf6065d22f935d2aa034a7065947"
        },
        {
          "identity": {
            "id": "e4d98490-3e38-553f-859b-c0528de045e2"
          },
          "contentHash": "7cc032f29a1e330b25eb6fb79461601e8186a592f044ba8f87b20bb4c0181565"
        },
        {
          "identity": {
            "id": "c136c319-fde7-538e-a9f4-bd9d01159646"
          },
          "contentHash": "057cfee5eb57e7021a9366129d7f1d806cbbec34cee518ace379523e94e8cee9"
        },
        {
          "identity": {
            "id": "010af5df-7881-5f28-9656-968fc59cc445"
          },
          "contentHash": "1ff83f44d17f27cafc4147ac20d04a8d1f4c1ff4bece968552e3b0f288f93b02"
        },
        {
          "identity": {
            "id": "b76b2885-6a80-5ecd-8fe8-8e06d2f4f093"
          },
          "contentHash": "de989bdbb5edbc3721b574cc66b56d2e8b2d0218d85cd75a468332a3447bea33"
        },
        {
          "identity": {
            "id": "aa785425-586c-5c01-b3df-8b90996161f2"
          },
          "contentHash": "94b5a905291c4bd8a026f5f3a38e26d85f637178c227f9451dbbf038d2657fed"
        },
        {
          "identity": {
            "id": "eac1e26f-2329-5881-8446-973529a135e3"
          },
          "contentHash": "778f40e2814ee8191b268afa289737c9a3b6900cb2b521ae78331e9d3acd1b6e"
        },
        {
          "identity": {
            "id": "6086b1e6-83f6-5908-babc-d5f17f3fda77"
          },
          "contentHash": "be7f74d1028462eebc8d24b8e3b259b762c799fd7d4d838c9166e51be67bd50b"
        }
      ]
    },
    {
      "table": "tournament_match_operation_players",
      "identity": [
        "id"
      ],
      "columns": [
        "attendance_status",
        "avatar_url_snapshot",
        "display_name_snapshot",
        "id",
        "is_captain",
        "is_goalkeeper",
        "lineup_status",
        "match_id",
        "match_operation_id",
        "organization_id",
        "position_snapshot",
        "roster_player_id",
        "shirt_number_snapshot",
        "team_entry_id"
      ],
      "columnKinds": {
        "attendance_status": "scalar",
        "avatar_url_snapshot": "scalar",
        "display_name_snapshot": "scalar",
        "id": "scalar",
        "is_captain": "scalar",
        "is_goalkeeper": "scalar",
        "lineup_status": "scalar",
        "match_id": "scalar",
        "match_operation_id": "scalar",
        "organization_id": "scalar",
        "position_snapshot": "scalar",
        "roster_player_id": "scalar",
        "shirt_number_snapshot": "number",
        "team_entry_id": "scalar"
      },
      "ownership": {
        "column": "organization_id",
        "values": [
          "a5627c00-6b91-59b8-a366-455261e6e8de"
        ]
      },
      "rows": [
        {
          "identity": {
            "id": "ebdda34d-02f2-51a9-845a-f499b13e9226"
          },
          "contentHash": "180e711806372abb27e2d8ec2562562cf6203ad7bc8f3774075eb3b0119e479a"
        },
        {
          "identity": {
            "id": "4adb5c9c-4f2f-526d-9791-abf92a5d31a4"
          },
          "contentHash": "1b765494115ff418805477a3e55741927bc26e91ed870d4cac5b376226547b9f"
        },
        {
          "identity": {
            "id": "a7d5d28b-f581-5bd8-9865-de1c24aa7b42"
          },
          "contentHash": "3ea7db42cc2732af2ec0b546d35f5275a0dd06060c306c555f89881299df3967"
        },
        {
          "identity": {
            "id": "f6d13967-1f43-5b13-a639-65382aa0ec64"
          },
          "contentHash": "687d95cfe683560f13b0a66ee39f95e0fbcc908ad1f927fa4e8facb679759ef5"
        },
        {
          "identity": {
            "id": "f83f2962-231b-5961-9023-2bb72e1860d4"
          },
          "contentHash": "86a384b047ea71be1c49ac1cce069c2a199d8f971967d5e6206551df78d91224"
        },
        {
          "identity": {
            "id": "268e2a13-93f1-535f-ac23-2bfb68b861b0"
          },
          "contentHash": "a9748082d4a9162c789a9bcf7847bd8e2d40e04c7261426b392233ff459399eb"
        },
        {
          "identity": {
            "id": "13f48678-cf7e-5393-ad79-6864cb205843"
          },
          "contentHash": "d33b13331f8d2ca45f4649ad4d799d394a078f3ff842c71629d3c082adc0ce8c"
        },
        {
          "identity": {
            "id": "1e77b20a-9eaa-5cc3-8582-b815ee710bd4"
          },
          "contentHash": "5e45f2f14ec497fe8a8404bb02946686e100129affbc10451c7d02ecfedb73d8"
        },
        {
          "identity": {
            "id": "6d5300d6-b159-565c-bf0c-92692d422c66"
          },
          "contentHash": "d17664d2c664a117d51fd4e75b1f19ef7b9f7e6b2386d25d111831b67948b28e"
        },
        {
          "identity": {
            "id": "599095df-f920-532a-979f-c8b990af33c9"
          },
          "contentHash": "ebcaf19dbc1e79354104272af989afd8eea122735e0d5012f27b64f02a12cc91"
        },
        {
          "identity": {
            "id": "f83649c1-c4a0-5e31-94a3-e1762abbe56e"
          },
          "contentHash": "b7381c47b5c118df0748812a9d8d5d42726ac32cd97659f82fb7a2576190f43e"
        },
        {
          "identity": {
            "id": "45bbc711-1547-5bef-86f7-9035ab7e9a28"
          },
          "contentHash": "ca2da48f966a02c2ba38a9c6f053d1a093b965ab26cdc9f76d8968a8ea13208e"
        },
        {
          "identity": {
            "id": "63e2f75e-1fe9-5aeb-bac5-693c655d2003"
          },
          "contentHash": "31a04448afa70f345c099cf86f30447d4a9eb8c4bedeafc2bd04072aa482e761"
        },
        {
          "identity": {
            "id": "f5d9d572-8e39-5fdc-b15b-cf9057609866"
          },
          "contentHash": "79649325f5a17240ac9730d8dac0ebfd5ed0ebd3a733b521c2644f63e64f5f97"
        },
        {
          "identity": {
            "id": "ff5535f0-6b96-58dc-ae97-a1b9243889a0"
          },
          "contentHash": "8476ab75dace999fb4663508a50e1966581d3b1e6db59e6bfd94f7da5e01af60"
        },
        {
          "identity": {
            "id": "25cf1cc5-cf92-55de-86d5-9e03a1044438"
          },
          "contentHash": "b16404cc0610dd09cb6b8aa16d93f9f91b45ca79482831f8f846be1f17678226"
        },
        {
          "identity": {
            "id": "363aff63-3d03-5670-be0d-faffe19472be"
          },
          "contentHash": "51dd96bf1e5d3ff175acf6207020d3c904d36f83cde5e2da370c81e20b682965"
        },
        {
          "identity": {
            "id": "66d26b40-4d56-58db-8a3d-da90208d134d"
          },
          "contentHash": "93f00f9ca854cfc5963da7c56c1ac6146e11d16e5b307ae058585db335ef213a"
        },
        {
          "identity": {
            "id": "de12358e-f439-54da-81d6-83e542bd3679"
          },
          "contentHash": "b652e6accf64c4d55ff463aa318701da59552372e89c2d0b6e676db0fccd9c13"
        },
        {
          "identity": {
            "id": "c01f5d31-a81c-5898-b9d5-444e4f4a5c1f"
          },
          "contentHash": "6ab56fce972f0968dc77a4a0b3018cdb2a45d0d08cf52069ac13890c43a38e04"
        },
        {
          "identity": {
            "id": "5d214c91-5e7f-509f-9e57-b3fdd4318c66"
          },
          "contentHash": "f1411ef2ab71a608daf7ead2669f0301511b959332bcfb524ee51da6c95cf1e5"
        },
        {
          "identity": {
            "id": "1bd502af-01cc-5962-9134-4e9e0b5efbd1"
          },
          "contentHash": "b0ac6bd8e3d95b318d93dfa0d1ca8088272b1b30a35146add6621b754ae4def0"
        },
        {
          "identity": {
            "id": "df95b9e7-1407-5c0a-897f-276fb464e080"
          },
          "contentHash": "40b65ced40230fbe41c6360de3dea4a89f8610d322e0ad8a0aef30d761dccfe5"
        },
        {
          "identity": {
            "id": "06a06593-2a31-5123-96d6-526aaf63c68d"
          },
          "contentHash": "2b1216e8a1c2603d67874a3ca44f89fe04a4cf51a3f53bc730898a1bd7f28aee"
        },
        {
          "identity": {
            "id": "ea4d943c-423c-5412-97f3-d3843dc2e7f4"
          },
          "contentHash": "7a15f52c24b91e829528f52a52547d57ce62cc0529ad6f4d4d73fb56deae866f"
        }
      ]
    },
    {
      "table": "tournament_match_scores",
      "identity": [
        "match_operation_id"
      ],
      "columns": [
        "away_penalties",
        "away_score",
        "away_score_first_half",
        "home_penalties",
        "home_score",
        "home_score_first_half",
        "match_id",
        "match_operation_id",
        "organization_id",
        "score_type"
      ],
      "columnKinds": {
        "away_penalties": "number",
        "away_score": "number",
        "away_score_first_half": "nullable",
        "home_penalties": "number",
        "home_score": "number",
        "home_score_first_half": "nullable",
        "match_id": "scalar",
        "match_operation_id": "scalar",
        "organization_id": "scalar",
        "score_type": "scalar"
      },
      "ownership": {
        "column": "organization_id",
        "values": [
          "a5627c00-6b91-59b8-a366-455261e6e8de"
        ]
      },
      "rows": [
        {
          "identity": {
            "match_operation_id": "2ef07000-caf4-5450-b292-1e439efa6c31"
          },
          "contentHash": "c26d4f88ba249106f071e616a7abab84adb7f63f6c527880f60794603cf3682b"
        },
        {
          "identity": {
            "match_operation_id": "239e703a-8ccf-5bfe-8fc0-cd32242cdcab"
          },
          "contentHash": "85091cefd694ec0d1157d0d288b9efeef2ebc781e0475d5532657f896b9412ed"
        },
        {
          "identity": {
            "match_operation_id": "27a57280-6c4a-50d5-82ef-d6716634ec10"
          },
          "contentHash": "edc3d9fa217d4cbe09c844713de4a4751b1732affc582eb5a62c5512f8bb8af7"
        },
        {
          "identity": {
            "match_operation_id": "13926915-cf0f-5b41-8216-599d2838988e"
          },
          "contentHash": "3b383f406aab1d25e30a14059527ce0738a974989e2abe5bbc25f86d1b4d3067"
        },
        {
          "identity": {
            "match_operation_id": "d32166a5-023b-5763-ae4f-43de66248ab6"
          },
          "contentHash": "7612498a9c0c6417919569b6a86378741dd46aa4b9a30e03c2e96fd38c40e2c2"
        },
        {
          "identity": {
            "match_operation_id": "cef0c5ce-baf7-53da-a915-a439ad513a7b"
          },
          "contentHash": "e1198c5e544afa3d9fb3710a964eaa95a5a00ba229ff98aad29c84488620ec7a"
        },
        {
          "identity": {
            "match_operation_id": "195bd909-8a50-5ccb-8091-d2251d161113"
          },
          "contentHash": "affce659bc4a68a473170098174432e5772b7a2889e7681d9292ec79e9c81afc"
        },
        {
          "identity": {
            "match_operation_id": "df821b06-857d-59d1-a47a-bdf58cf41f4b"
          },
          "contentHash": "1bbf5160a4ddb7fd64b517b06223f6be1e32f07820a388046479b55c8817bd1f"
        },
        {
          "identity": {
            "match_operation_id": "dedfd4a8-15f8-5cd9-82aa-5c3a2ff06eae"
          },
          "contentHash": "33d07eb83bb6630789033634820053a747d09546e1c19c7ebb65dfd57b141ab0"
        },
        {
          "identity": {
            "match_operation_id": "e71ecc2e-feed-59f2-9070-39eda2305672"
          },
          "contentHash": "69a944d7cfb6952a16436a48ee4b5c939aa72a25c0b7e1de8071723a3463c17d"
        },
        {
          "identity": {
            "match_operation_id": "07a93e19-c506-5011-9c8b-7a7251da9099"
          },
          "contentHash": "9b64866d967ec212c2e484d1321b7e1adbdaf593d02109db42ce4f9d722bd5b7"
        },
        {
          "identity": {
            "match_operation_id": "32f1c991-a8b8-5ea5-aa60-49f5dbb65371"
          },
          "contentHash": "7fdfaaba79411a2271030a749b670bb02bfb5d1d2463c13be13e2310329179f2"
        },
        {
          "identity": {
            "match_operation_id": "dac34595-2a42-597b-b849-4a3dbdc1fc3c"
          },
          "contentHash": "e384023a636d70aa2c9fb3088ae23ada2ea529a318d30db31e1dd871021f0c35"
        },
        {
          "identity": {
            "match_operation_id": "192b970b-af32-5f08-b54c-12536d4f1d6c"
          },
          "contentHash": "556c93dd8ddca6ee940d2a73cf5ebaa4b7f787523561f73e04e7271fcf5742bb"
        },
        {
          "identity": {
            "match_operation_id": "043bd394-a65d-5cf7-9e56-b0e61b800711"
          },
          "contentHash": "453edc334152483423c1c6c822f99b86105d882e14e67599ad8146a8562134c0"
        },
        {
          "identity": {
            "match_operation_id": "d837c669-e47f-51ca-9e32-5d3d89816af3"
          },
          "contentHash": "0fe1d5aeef34ec8a979ab61aba461fe93e400e8fcd497646a35b7cc92546b164"
        },
        {
          "identity": {
            "match_operation_id": "a8e3cb20-c1af-5a19-9ce1-1849506c4374"
          },
          "contentHash": "f6c4194c85ed46ac8c78f0d173255b025fc55f250b92867647e85ca54d719566"
        },
        {
          "identity": {
            "match_operation_id": "3ad3afe2-8688-5573-9726-408a6e012760"
          },
          "contentHash": "952b240ca14d62377757c4ed47df5be397fb870cf32465047c77689af698e194"
        },
        {
          "identity": {
            "match_operation_id": "79a6f2a2-b3a3-5529-accf-ca27e8625336"
          },
          "contentHash": "80b917701080e5ae9beaea05008f4dbc742864e9fda0f965210a2a878194437f"
        },
        {
          "identity": {
            "match_operation_id": "d6904074-ba15-53a0-9901-5167f7a8bff5"
          },
          "contentHash": "05a0bbb5f10b57ff339e318ab7aab400614c92d5b7b8df4d756652f99b664e28"
        },
        {
          "identity": {
            "match_operation_id": "027af416-08ef-57e0-91ec-ea11c8ba2696"
          },
          "contentHash": "6f766291b6502f73b98ec4909be31e516b1305b1b65aa60ba9206a2286db5b0e"
        },
        {
          "identity": {
            "match_operation_id": "7bf7a2f6-f063-52a7-912c-4b409cb4556d"
          },
          "contentHash": "c1a6c7cd03ebd5e091bc29ec46d0fd60d1346908532c15bb603cde154f3be03f"
        },
        {
          "identity": {
            "match_operation_id": "b0fba4b3-55d4-5776-973e-e84600211224"
          },
          "contentHash": "7e6b012ac001ce1b9461df37de28074dfce0f1f99d3b002da66e02652e0ec355"
        },
        {
          "identity": {
            "match_operation_id": "e4d98490-3e38-553f-859b-c0528de045e2"
          },
          "contentHash": "21bda158ec5edf730c670e6c876f8796f19fb6a4e0850bb7d439daea7cd3c627"
        },
        {
          "identity": {
            "match_operation_id": "c136c319-fde7-538e-a9f4-bd9d01159646"
          },
          "contentHash": "212c59c19f495011fddaedd34f28831883bccc61a7b16440e75c61d719f18219"
        },
        {
          "identity": {
            "match_operation_id": "010af5df-7881-5f28-9656-968fc59cc445"
          },
          "contentHash": "8024271cdc24c4f43cfcdbc8cd2a316a9029f2ff6833c2bf7e158a74b666bb6c"
        },
        {
          "identity": {
            "match_operation_id": "b76b2885-6a80-5ecd-8fe8-8e06d2f4f093"
          },
          "contentHash": "e1c59629cae837dc269db60fb04d6e37fc4b7f3a2bb4425adcabf33efcb20416"
        },
        {
          "identity": {
            "match_operation_id": "aa785425-586c-5c01-b3df-8b90996161f2"
          },
          "contentHash": "15767767cb170d5030305845b660fb1f5eb858b2a21dae1680ee1be034bdeeff"
        },
        {
          "identity": {
            "match_operation_id": "eac1e26f-2329-5881-8446-973529a135e3"
          },
          "contentHash": "ce2f4658b5b4bfd41fa514959a96db395f8ee2ca60c679b2c338ca16a1eb1483"
        },
        {
          "identity": {
            "match_operation_id": "6086b1e6-83f6-5908-babc-d5f17f3fda77"
          },
          "contentHash": "b253dca4cb288e61f236f9fd5a1cfdb1882e8e17453810708d50878e80dd28d4"
        }
      ]
    },
    {
      "table": "tournament_match_outcomes",
      "identity": [
        "match_operation_id"
      ],
      "columns": [
        "administrative_away_score",
        "administrative_home_score",
        "counts_for_player_stats",
        "counts_for_standings",
        "ended_at",
        "events_remain_valid",
        "match_id",
        "match_operation_id",
        "organization_id",
        "outcome_type",
        "reason_code",
        "reason_text",
        "requires_resolution",
        "resolved_at",
        "resolved_by",
        "started_at",
        "suspension_minute",
        "suspension_period"
      ],
      "columnKinds": {
        "administrative_away_score": "number",
        "administrative_home_score": "number",
        "counts_for_player_stats": "scalar",
        "counts_for_standings": "scalar",
        "ended_at": "scalar",
        "events_remain_valid": "scalar",
        "match_id": "scalar",
        "match_operation_id": "scalar",
        "organization_id": "scalar",
        "outcome_type": "scalar",
        "reason_code": "scalar",
        "reason_text": "scalar",
        "requires_resolution": "scalar",
        "resolved_at": "nullable",
        "resolved_by": "nullable",
        "started_at": "scalar",
        "suspension_minute": "number",
        "suspension_period": "scalar"
      },
      "ownership": {
        "column": "organization_id",
        "values": [
          "a5627c00-6b91-59b8-a366-455261e6e8de"
        ]
      },
      "rows": [
        {
          "identity": {
            "match_operation_id": "2ef07000-caf4-5450-b292-1e439efa6c31"
          },
          "contentHash": "3b9d8958363a81c6cb2f58130884bc23476bfeaeb0f77e2dc82540026e91fb11"
        },
        {
          "identity": {
            "match_operation_id": "239e703a-8ccf-5bfe-8fc0-cd32242cdcab"
          },
          "contentHash": "131bb5a3360232998c433ed18b6a1b1af460c69b7490b11c7c8798866357c352"
        },
        {
          "identity": {
            "match_operation_id": "27a57280-6c4a-50d5-82ef-d6716634ec10"
          },
          "contentHash": "bd27cc926aa0c8d81205dbf58c763f931379dce20d54aca6554d2db53488f71a"
        },
        {
          "identity": {
            "match_operation_id": "13926915-cf0f-5b41-8216-599d2838988e"
          },
          "contentHash": "8759b2ad43eec8a08aeac0603df00e60e25d3b41360627085b96a21c2e7bad01"
        },
        {
          "identity": {
            "match_operation_id": "a1414c8f-f8f5-57a4-875c-96006a9ba3e8"
          },
          "contentHash": "39c419789127ddec484dbecb2bc99e1cb31e3518b79b7b92ac92c4390a6a03c2"
        },
        {
          "identity": {
            "match_operation_id": "d32166a5-023b-5763-ae4f-43de66248ab6"
          },
          "contentHash": "ae34f4e7b533782e76022ef642742df6ace06190df1609fde3de118602ec86f8"
        },
        {
          "identity": {
            "match_operation_id": "cef0c5ce-baf7-53da-a915-a439ad513a7b"
          },
          "contentHash": "84bcf6048c0e5b7aff164040651e0834a3328c5f9a65a304c7b0013b71d0077b"
        },
        {
          "identity": {
            "match_operation_id": "195bd909-8a50-5ccb-8091-d2251d161113"
          },
          "contentHash": "8dc8fddc75c7694b40a5173a6a62955146956b802b6f565ecde607484040fd8b"
        },
        {
          "identity": {
            "match_operation_id": "df821b06-857d-59d1-a47a-bdf58cf41f4b"
          },
          "contentHash": "6d892b99c2fbe4efb39036eb8b22f8635dfcc36a4214c49e47e69b8ba58bb598"
        },
        {
          "identity": {
            "match_operation_id": "dedfd4a8-15f8-5cd9-82aa-5c3a2ff06eae"
          },
          "contentHash": "4cb24ac2a3fce768f6e0b3745b14427ac824b4aed59b5e9e1d183ad9c89a1213"
        },
        {
          "identity": {
            "match_operation_id": "e71ecc2e-feed-59f2-9070-39eda2305672"
          },
          "contentHash": "042d8c8a7db4e357ad3e9605b1bd78d96c4de0e2dbb5d2e1bd36309573c16286"
        },
        {
          "identity": {
            "match_operation_id": "07a93e19-c506-5011-9c8b-7a7251da9099"
          },
          "contentHash": "bc9766f08940e8c228c29eb0c9b3ef2bdcf0a91c5411d678879267515c8e8db1"
        },
        {
          "identity": {
            "match_operation_id": "32f1c991-a8b8-5ea5-aa60-49f5dbb65371"
          },
          "contentHash": "d532603d8ecfe7c34792666cd78450062b69436888d2a9cbd1e0f8df5af3bc6d"
        },
        {
          "identity": {
            "match_operation_id": "dac34595-2a42-597b-b849-4a3dbdc1fc3c"
          },
          "contentHash": "6873caec9346885abeceba8bd5a9d11029c12c1f3089434db336f981a6326a85"
        },
        {
          "identity": {
            "match_operation_id": "192b970b-af32-5f08-b54c-12536d4f1d6c"
          },
          "contentHash": "d5cb4a9d30958705690db40c42cbc0fd7d1aaafc4a525497ea7e36b0213b2ce7"
        },
        {
          "identity": {
            "match_operation_id": "043bd394-a65d-5cf7-9e56-b0e61b800711"
          },
          "contentHash": "f3c4b9dd22dd3a74d1f69a21100a3f2c53e03d24c2c8cb09d49e5a09931566c7"
        },
        {
          "identity": {
            "match_operation_id": "d837c669-e47f-51ca-9e32-5d3d89816af3"
          },
          "contentHash": "34beec85f7b00b37e9e14ca3d2cd8248dfec3b6bb95bb891e0ea9aed0fcf74b2"
        },
        {
          "identity": {
            "match_operation_id": "a8e3cb20-c1af-5a19-9ce1-1849506c4374"
          },
          "contentHash": "e2cdba5ab9e06ca8d9e9f93778deeaddf5c3b3fcbffb6a732106e17b219b8424"
        },
        {
          "identity": {
            "match_operation_id": "3ad3afe2-8688-5573-9726-408a6e012760"
          },
          "contentHash": "097b8cdf9d44b86a6385ab2ddd3280c68568a3b6ba2b06e6ecd6adafc605fbdf"
        },
        {
          "identity": {
            "match_operation_id": "79a6f2a2-b3a3-5529-accf-ca27e8625336"
          },
          "contentHash": "04a24661f91367c6c6b9a8056cb4b33ad1800cd9811b06cde43b0f934a086b02"
        },
        {
          "identity": {
            "match_operation_id": "d6904074-ba15-53a0-9901-5167f7a8bff5"
          },
          "contentHash": "9c9dc2dd8d3eb2af7a2f52621521c8157e487ad40d384da63bcadb86cf5581a5"
        },
        {
          "identity": {
            "match_operation_id": "027af416-08ef-57e0-91ec-ea11c8ba2696"
          },
          "contentHash": "5aecd02e6ac6c49cc0779eff87e7d434e3e024a882246d45c98e50d51685a8d3"
        },
        {
          "identity": {
            "match_operation_id": "7bf7a2f6-f063-52a7-912c-4b409cb4556d"
          },
          "contentHash": "0ca644e9779d58a88aa9886be2fc0d8acc8ac620d30b613a998d2b5f9fa5fcb2"
        },
        {
          "identity": {
            "match_operation_id": "b0fba4b3-55d4-5776-973e-e84600211224"
          },
          "contentHash": "8bc88556f5705fc5ad3dad2860c1acbda32a89c5d401ee84598600bf3879522b"
        },
        {
          "identity": {
            "match_operation_id": "e4d98490-3e38-553f-859b-c0528de045e2"
          },
          "contentHash": "ac0e80d059885c682a2249fb26114745eb86f9d70162de003b1ae5ab200a3de4"
        },
        {
          "identity": {
            "match_operation_id": "c136c319-fde7-538e-a9f4-bd9d01159646"
          },
          "contentHash": "a5aa7a64be6be675c09b95b53b1699c1b0d8f162d43d55c1f244319517ed94c3"
        },
        {
          "identity": {
            "match_operation_id": "010af5df-7881-5f28-9656-968fc59cc445"
          },
          "contentHash": "ffeb91bd11847767b98d9736a4ec14c2688a65ea19d35dc6c6cc48f649063c99"
        },
        {
          "identity": {
            "match_operation_id": "b76b2885-6a80-5ecd-8fe8-8e06d2f4f093"
          },
          "contentHash": "d55a84c4c9006c90cf02816fd7103d1a9c56f98e87050065dff2608a90491541"
        },
        {
          "identity": {
            "match_operation_id": "aa785425-586c-5c01-b3df-8b90996161f2"
          },
          "contentHash": "73ea6409ac9895fe112ae2d7f066c7223bceedd8afde98dccaf07e9786184b80"
        },
        {
          "identity": {
            "match_operation_id": "eac1e26f-2329-5881-8446-973529a135e3"
          },
          "contentHash": "8e70ef241ecd8677535f411db51ec8b70fb94c1885c01ae2eaeddc7e1a4b5028"
        },
        {
          "identity": {
            "match_operation_id": "6086b1e6-83f6-5908-babc-d5f17f3fda77"
          },
          "contentHash": "6a241c03f18ae2db08f025f9763802ac31749072b0415dce2dbc8d81c95adcfc"
        }
      ]
    },
    {
      "table": "tournament_match_events",
      "identity": [
        "id"
      ],
      "columns": [
        "created_by",
        "event_type",
        "id",
        "match_id",
        "match_operation_id",
        "metadata",
        "minute",
        "organization_id",
        "period",
        "related_event_id",
        "related_roster_player_id",
        "roster_player_id",
        "sequence_number",
        "team_entry_id",
        "unidentified_player_reason"
      ],
      "columnKinds": {
        "created_by": "scalar",
        "event_type": "scalar",
        "id": "scalar",
        "match_id": "scalar",
        "match_operation_id": "scalar",
        "metadata": "scalar",
        "minute": "number",
        "organization_id": "scalar",
        "period": "scalar",
        "related_event_id": "scalar",
        "related_roster_player_id": "scalar",
        "roster_player_id": "scalar",
        "sequence_number": "number",
        "team_entry_id": "scalar",
        "unidentified_player_reason": "nullable"
      },
      "ownership": {
        "column": "organization_id",
        "values": [
          "a5627c00-6b91-59b8-a366-455261e6e8de"
        ]
      },
      "rows": [
        {
          "identity": {
            "id": "6bb1aaa1-0fa6-5671-a47b-c809ec7901e4"
          },
          "contentHash": "e1c68043757ec940109feb1669c0e6bc0d3b7d1d43663f46ded4defc31242e2e"
        },
        {
          "identity": {
            "id": "f61a0582-da84-56f6-88e9-7e29af9d4994"
          },
          "contentHash": "84ac7b7113781cdbe9ececf81fdc97043bffced787bfef0ec491d9d93a0d5f16"
        },
        {
          "identity": {
            "id": "ceeb244d-9d85-5b0d-a352-6b8b0487b165"
          },
          "contentHash": "f6ac67442881b97aa667092d26b400fdb8389265a2eb237fcdb8e995d97ec700"
        },
        {
          "identity": {
            "id": "f5a35cb6-7802-5c5c-9cd8-c7229f5b31d9"
          },
          "contentHash": "120ce919f5abcbdf9724712cfb03f28bb1e197c7639ba56feb9780772a7db9f9"
        },
        {
          "identity": {
            "id": "92a5a75e-dbfc-56a6-9f4a-f89fdbcedf30"
          },
          "contentHash": "d54eb6bc75664bfbad7118d2271ff527bfa323ffdf88ec5b6920341009ee7e46"
        },
        {
          "identity": {
            "id": "400c8bf3-d320-5e50-b10f-e0bfeaa678f1"
          },
          "contentHash": "81ace9a3ae654ef55ed0fc6f35d61ee913e38b12b3cfd66af50bc6c256a7f025"
        },
        {
          "identity": {
            "id": "ddd402ee-0c52-5d64-be73-ff0a5c9d5db9"
          },
          "contentHash": "27769553de4359aef46fe804b89a0c3d18506b2e1324c51ac487175095261680"
        },
        {
          "identity": {
            "id": "32265c60-8670-5472-9ece-74fcaa349c74"
          },
          "contentHash": "c5d9f1aa1ca625495ac8c1056ba24588c05fbc8ea12ab909dc65d24caa84f429"
        },
        {
          "identity": {
            "id": "4e30727c-7fcc-5a33-aa29-f53cd39d4f66"
          },
          "contentHash": "8170faa64ae5fd3f8dee7bd49ed0129ff96e30ed674aebadfa3dc705d8dfc8dc"
        },
        {
          "identity": {
            "id": "8283dd69-5574-5763-ac96-c14cc75384f7"
          },
          "contentHash": "7bbb5cdc4ec97c32206feb02fecf3f735bd8e90be8be56be395a3d717e998030"
        },
        {
          "identity": {
            "id": "6c21f914-8854-515f-9bc4-d04fe5f4f74f"
          },
          "contentHash": "f833b69d18c6a82908b3bd2e80563e03bac7b78e790949b99e2286c26e13e46d"
        },
        {
          "identity": {
            "id": "ec159b17-8d9b-5844-b242-225e6118ba4b"
          },
          "contentHash": "3b9744bc293aa631b363d7abbf6462a75d241128e9046a40cc48411dc54ae168"
        },
        {
          "identity": {
            "id": "885e5cf9-a62e-57d1-9bf8-83c0dcbbf19a"
          },
          "contentHash": "0755d043172c488feadac501ea6bb79e5012d2d350da5bd4968c7eaba7ad0d7b"
        },
        {
          "identity": {
            "id": "c5354046-13db-5d4e-9ea3-7d994a90c0db"
          },
          "contentHash": "1f2655e2d8c0f3845e5e3cd6572b6bd05849b3e7db454af72bf36b736f666dd2"
        }
      ]
    },
    {
      "table": "tournament_match_reviews",
      "identity": [
        "id"
      ],
      "columns": [
        "id",
        "match_operation_id",
        "organization_id",
        "reason",
        "requested_at",
        "requested_by",
        "resolution",
        "resolved_at",
        "resolved_by",
        "review_type",
        "status"
      ],
      "columnKinds": {
        "id": "scalar",
        "match_operation_id": "scalar",
        "organization_id": "scalar",
        "reason": "scalar",
        "requested_at": "scalar",
        "requested_by": "scalar",
        "resolution": "nullable",
        "resolved_at": "nullable",
        "resolved_by": "nullable",
        "review_type": "scalar",
        "status": "scalar"
      },
      "ownership": {
        "column": "organization_id",
        "values": [
          "a5627c00-6b91-59b8-a366-455261e6e8de"
        ]
      },
      "rows": [
        {
          "identity": {
            "id": "b0f170bb-804e-578f-8ff0-6b9fc0a13a95"
          },
          "contentHash": "3f9924cf16e82380299ba738248ec2a5fe3577acaa49cb4da40ece8bd7b4ae01"
        },
        {
          "identity": {
            "id": "d234c8c0-c05b-5a68-a88e-f8a10fdcf2d7"
          },
          "contentHash": "f8daf4f109664c6f4706c7b728824f3bf4475e57b378488113fcbeb5ac16197c"
        }
      ]
    },
    {
      "table": "tournament_standings_revisions",
      "identity": [
        "id"
      ],
      "columns": [
        "calculated_at",
        "calculated_by",
        "category_id",
        "configuration_snapshot",
        "discard_reason",
        "discarded_at",
        "discarded_by",
        "fixture_version_id",
        "group_id",
        "id",
        "idempotency_key",
        "organization_id",
        "phase_id",
        "published_at",
        "published_by",
        "rebuild_reason",
        "revision_number",
        "season_id",
        "source_fingerprint",
        "status",
        "superseded_at",
        "tournament_id"
      ],
      "columnKinds": {
        "calculated_at": "scalar",
        "calculated_by": "scalar",
        "category_id": "scalar",
        "configuration_snapshot": "scalar",
        "discard_reason": "nullable",
        "discarded_at": "nullable",
        "discarded_by": "nullable",
        "fixture_version_id": "scalar",
        "group_id": "nullable",
        "id": "scalar",
        "idempotency_key": "scalar",
        "organization_id": "scalar",
        "phase_id": "scalar",
        "published_at": "scalar",
        "published_by": "scalar",
        "rebuild_reason": "scalar",
        "revision_number": "number",
        "season_id": "scalar",
        "source_fingerprint": "scalar",
        "status": "scalar",
        "superseded_at": "nullable",
        "tournament_id": "scalar"
      },
      "ownership": {
        "column": "organization_id",
        "values": [
          "a5627c00-6b91-59b8-a366-455261e6e8de"
        ]
      },
      "rows": [
        {
          "identity": {
            "id": "ac146a54-adf2-54da-9fa5-9a6e18a88118"
          },
          "contentHash": "b54719540c03b1f79152e5e8224ef6cc8d5e65365db9838fd4fb053426896236"
        }
      ]
    },
    {
      "table": "tournament_projection_sources",
      "identity": [
        "revision_id",
        "match_operation_id"
      ],
      "columns": [
        "match_id",
        "match_operation_id",
        "official_at",
        "organization_id",
        "revision_id"
      ],
      "columnKinds": {
        "match_id": "scalar",
        "match_operation_id": "scalar",
        "official_at": "scalar",
        "organization_id": "scalar",
        "revision_id": "scalar"
      },
      "ownership": {
        "column": "organization_id",
        "values": [
          "a5627c00-6b91-59b8-a366-455261e6e8de"
        ]
      },
      "rows": [
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "match_operation_id": "2ef07000-caf4-5450-b292-1e439efa6c31"
          },
          "contentHash": "57a63a7a44a17ebd94c29997929a099ef497d273945993ad0c447c4d3aefc410"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "match_operation_id": "239e703a-8ccf-5bfe-8fc0-cd32242cdcab"
          },
          "contentHash": "ff5cf656704e73554831549f90a1e4ef59515373eaeecfbffbb777c02471879d"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "match_operation_id": "27a57280-6c4a-50d5-82ef-d6716634ec10"
          },
          "contentHash": "261613482473df960d58c2574f14a6ab4243a0a0bd19f149205814c78b115db2"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "match_operation_id": "cef0c5ce-baf7-53da-a915-a439ad513a7b"
          },
          "contentHash": "c6d09ac7d01ea471e59ecfc87d6aed1c1a6c1852c37f18f67d0f14ddaa737453"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "match_operation_id": "195bd909-8a50-5ccb-8091-d2251d161113"
          },
          "contentHash": "e2640544694380712bfc7cb87325e71e20c776dc0d471f9abcccc269322554f4"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "match_operation_id": "df821b06-857d-59d1-a47a-bdf58cf41f4b"
          },
          "contentHash": "96b0430a2b7e4002033fe0123aa9a2e52e9cae24606fd5e447f155157bf39baa"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "match_operation_id": "dedfd4a8-15f8-5cd9-82aa-5c3a2ff06eae"
          },
          "contentHash": "6ac81523f58fa498554c7ff788cd939c101e7d2cbb13d3641f80d0445da1afb1"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "match_operation_id": "e71ecc2e-feed-59f2-9070-39eda2305672"
          },
          "contentHash": "cb81e2fdaa79c93d1a163177fd7b6d23bdb263266c66bce98ec34a067f62a24a"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "match_operation_id": "07a93e19-c506-5011-9c8b-7a7251da9099"
          },
          "contentHash": "f957dfdae3ea59effd77ae5346a4a3bfcfe1e76c1408e0041b2424ad42b438b9"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "match_operation_id": "32f1c991-a8b8-5ea5-aa60-49f5dbb65371"
          },
          "contentHash": "da0b24aec9a7184a75e7c6c2e9f6d9f7d6c9309d6f7a6429a2c1cc03f3151bae"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "match_operation_id": "dac34595-2a42-597b-b849-4a3dbdc1fc3c"
          },
          "contentHash": "10175f0e5b22f43ec7de81d10682537cce12aaa7eb4df0f7692311d959dd2ac2"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "match_operation_id": "192b970b-af32-5f08-b54c-12536d4f1d6c"
          },
          "contentHash": "95695d6fa1b656bc02bba77c59b1076df3ad8116ddb924313976e7a21c1b002f"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "match_operation_id": "043bd394-a65d-5cf7-9e56-b0e61b800711"
          },
          "contentHash": "11691542f9c0dc3426cd9034bd80f768eea8101a148e67705d20dc83ff191a39"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "match_operation_id": "d837c669-e47f-51ca-9e32-5d3d89816af3"
          },
          "contentHash": "c33851423fb68c0bbe002315c46b908913c04ca9bb7695a05b3afbdf1700d849"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "match_operation_id": "a8e3cb20-c1af-5a19-9ce1-1849506c4374"
          },
          "contentHash": "a991b4638f1ec6f665d033e3da3718a003b647f53582c0eadf774d8eef6789ef"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "match_operation_id": "3ad3afe2-8688-5573-9726-408a6e012760"
          },
          "contentHash": "08ff5b1b2bf661efb9d7e8f8a2041b32099b92d0a355717d27999211fe9c85ba"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "match_operation_id": "79a6f2a2-b3a3-5529-accf-ca27e8625336"
          },
          "contentHash": "bf214e7345b9a9e4d07532db6f0d3146d86e0281fdce0f00a8cdc876092c4395"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "match_operation_id": "d6904074-ba15-53a0-9901-5167f7a8bff5"
          },
          "contentHash": "904a14b8313a58525d471d000787cd3c1d5bf36e4d3fcd770e72a8e354bb9220"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "match_operation_id": "027af416-08ef-57e0-91ec-ea11c8ba2696"
          },
          "contentHash": "291d188022a6318c028c0a22682ea0ed6e753cd584bd63ef687330685f6d2b1d"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "match_operation_id": "7bf7a2f6-f063-52a7-912c-4b409cb4556d"
          },
          "contentHash": "6f675427bf52274c96375a327f030d6d633d556dd5dc7cf085bfe0257424917f"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "match_operation_id": "b0fba4b3-55d4-5776-973e-e84600211224"
          },
          "contentHash": "d1553bf5d4847aa9191e72b845e328a5b9ea1b583671a254e5e462ba7c2f7f4e"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "match_operation_id": "e4d98490-3e38-553f-859b-c0528de045e2"
          },
          "contentHash": "dfb55751687fdb9bdace8ffc1300de815d51311d0779508abd13c25ad7ccd51f"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "match_operation_id": "c136c319-fde7-538e-a9f4-bd9d01159646"
          },
          "contentHash": "9e5b7519e6dd95783d043e674c65dcf89214ccc92481195d79ec238ce10d27f7"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "match_operation_id": "010af5df-7881-5f28-9656-968fc59cc445"
          },
          "contentHash": "3adf3d96b07dbc9777c2c9bd1ca8611eb46570d65c34c5eebe48f57f197eda41"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "match_operation_id": "b76b2885-6a80-5ecd-8fe8-8e06d2f4f093"
          },
          "contentHash": "478ae016b41e3505c998fa1eeadc17bf500db5c7e2cfb0ce41b3efaa0ab9ca00"
        }
      ]
    },
    {
      "table": "tournament_team_standings",
      "identity": [
        "id"
      ],
      "columns": [
        "administrative_results",
        "base_points",
        "category_id",
        "classification_status",
        "drawn",
        "fair_play_points",
        "goal_difference",
        "goals_against",
        "goals_for",
        "group_id",
        "id",
        "lost",
        "organization_id",
        "participant_id",
        "phase_id",
        "played",
        "points",
        "points_adjustment",
        "position",
        "revision_id",
        "team_entry_id",
        "tiebreak_trace",
        "tournament_id",
        "walkovers",
        "won"
      ],
      "columnKinds": {
        "administrative_results": "number",
        "base_points": "number",
        "category_id": "scalar",
        "classification_status": "scalar",
        "drawn": "number",
        "fair_play_points": "number",
        "goal_difference": "number",
        "goals_against": "number",
        "goals_for": "number",
        "group_id": "nullable",
        "id": "scalar",
        "lost": "number",
        "organization_id": "scalar",
        "participant_id": "scalar",
        "phase_id": "scalar",
        "played": "number",
        "points": "number",
        "points_adjustment": "number",
        "position": "number",
        "revision_id": "scalar",
        "team_entry_id": "scalar",
        "tiebreak_trace": "scalar",
        "tournament_id": "scalar",
        "walkovers": "number",
        "won": "number"
      },
      "ownership": {
        "column": "organization_id",
        "values": [
          "a5627c00-6b91-59b8-a366-455261e6e8de"
        ]
      },
      "rows": [
        {
          "identity": {
            "id": "6b11d566-532b-540e-9e49-9a31cc742f87"
          },
          "contentHash": "56abe65bc6ddb5ae157f15cd78270c3c466303976c9dab1c9436c6a8ef649fcf"
        },
        {
          "identity": {
            "id": "66874cb7-cba0-5faa-8013-798a921e2eb1"
          },
          "contentHash": "721782cc54e15739df054281af85fe22ec58719a605f3c9f1d552d31eef2b094"
        },
        {
          "identity": {
            "id": "30630861-8887-5f1a-8f88-37451a79d2a0"
          },
          "contentHash": "f9a06ace11019c98d2a6ff5a93004524b423561e916cd74a0447775899aa476a"
        },
        {
          "identity": {
            "id": "1e7a4951-aa30-524d-94c0-14e5ffc13c50"
          },
          "contentHash": "1562915a2d470ac95772c675859ea2f8e90dfd6d3d17aa81f191f6c6f8842a33"
        },
        {
          "identity": {
            "id": "b2e87619-ef3e-5705-b175-5873919fc275"
          },
          "contentHash": "87fb260d8fbe4d838b9236d14eb8cfba42c8019a8c9ae8dc4cf5aa584870a8da"
        },
        {
          "identity": {
            "id": "6054dafe-87f6-5229-b3f9-ebfb3ebf340f"
          },
          "contentHash": "c4d5d380b0499529722ead7ded80990f77ff4f76feb963f0403aee1d6596ca9d"
        },
        {
          "identity": {
            "id": "54471530-b89d-545e-abe5-2427d305b7d9"
          },
          "contentHash": "d416c2e0ce6cb360a1da480f3c686138913f33c1260869f57d7de206cda2fc73"
        },
        {
          "identity": {
            "id": "1ccf7931-1f02-5903-a6c1-2681bdf54864"
          },
          "contentHash": "63f87c53a92bc8d68cfe566369894c7fc75c9b96d2c1f3e94230d64fa96db973"
        }
      ]
    },
    {
      "table": "tournament_team_statistics",
      "identity": [
        "revision_id",
        "participant_id"
      ],
      "columns": [
        "administrative_matches",
        "away_played",
        "goals",
        "home_played",
        "organization_id",
        "own_goals_benefited",
        "participant_id",
        "recent_form",
        "red_cards",
        "revision_id",
        "second_yellows",
        "streak_count",
        "streak_type",
        "suspended_matches",
        "team_entry_id",
        "yellow_cards"
      ],
      "columnKinds": {
        "administrative_matches": "number",
        "away_played": "number",
        "goals": "number",
        "home_played": "number",
        "organization_id": "scalar",
        "own_goals_benefited": "number",
        "participant_id": "scalar",
        "recent_form": "json",
        "red_cards": "number",
        "revision_id": "scalar",
        "second_yellows": "number",
        "streak_count": "number",
        "streak_type": "nullable",
        "suspended_matches": "number",
        "team_entry_id": "scalar",
        "yellow_cards": "number"
      },
      "ownership": {
        "column": "organization_id",
        "values": [
          "a5627c00-6b91-59b8-a366-455261e6e8de"
        ]
      },
      "rows": [
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "participant_id": "8bb07b14-7628-53c9-87e0-077a5f8b954c"
          },
          "contentHash": "31efb40cad3448ca282ba10d7d121dd856b123ecc71a5db7a9993915d94bec17"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "participant_id": "dcae962c-9ee6-58ea-8879-50b90f4d6b6a"
          },
          "contentHash": "7cade89bc134ff6daaabab50d2b36e07459e1c168fd49916054289a17d27e2ea"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "participant_id": "993369e6-b061-5cd0-be5b-718510b6b993"
          },
          "contentHash": "b0190e3e9046a9fddaf2b5e34f5fdc9378d06d197050e48eb53c765c4dfe088b"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "participant_id": "d7814279-6d96-54e6-8a9d-dbfc7fd1bea6"
          },
          "contentHash": "c9ba8b37bed876f83d43e59a67e7645a74c90e57716168ed8e9de0873cebdfd6"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "participant_id": "a94b75ef-3f02-53e0-bea2-63851d33a1a3"
          },
          "contentHash": "c86989d15225e101b5feae377ea1c9ffdf2400d3752c0ddcfcc2eaa5d60b8774"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "participant_id": "04b474c0-9749-5761-970c-022be84c0e7a"
          },
          "contentHash": "d1d00b51d95e0c4e3074b620db277f682dc889c0a5397746a7645894b92f31ac"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "participant_id": "d876f66c-4e39-5daa-ba2f-8f03a2674462"
          },
          "contentHash": "63c613c8658419f74ade422fbea290019cf2a54280ea992c74e17469b6e86ea3"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "participant_id": "81f678ee-6c55-5690-b32e-5fc82db5ab3d"
          },
          "contentHash": "ed9f0b60cac6e0048983a1560811188a14a5965eea8b1b4ea8073c6134bb4cfa"
        }
      ]
    },
    {
      "table": "tournament_player_statistics",
      "identity": [
        "revision_id",
        "roster_player_id"
      ],
      "columns": [
        "appearances",
        "assists",
        "captaincies",
        "category_id",
        "goals",
        "minutes_played",
        "organization_id",
        "own_goals",
        "penalties_missed",
        "penalty_goals",
        "red_cards",
        "revision_id",
        "roster_player_id",
        "second_yellows",
        "squad_calls",
        "starts",
        "substitute_appearances",
        "team_entry_id",
        "tournament_id",
        "yellow_cards"
      ],
      "columnKinds": {
        "appearances": "number",
        "assists": "number",
        "captaincies": "number",
        "category_id": "scalar",
        "goals": "number",
        "minutes_played": "nullable",
        "organization_id": "scalar",
        "own_goals": "number",
        "penalties_missed": "number",
        "penalty_goals": "number",
        "red_cards": "number",
        "revision_id": "scalar",
        "roster_player_id": "scalar",
        "second_yellows": "number",
        "squad_calls": "number",
        "starts": "number",
        "substitute_appearances": "number",
        "team_entry_id": "scalar",
        "tournament_id": "scalar",
        "yellow_cards": "number"
      },
      "ownership": {
        "column": "organization_id",
        "values": [
          "a5627c00-6b91-59b8-a366-455261e6e8de"
        ]
      },
      "rows": [
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "a3370601-8ffe-52a0-a802-b6d376a528e2"
          },
          "contentHash": "7cbce266e84e21e025b6d933330d78364b43e8d3da3dc0b7565c6e459e118dc0"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "09041088-abbd-50ec-b204-17b234ceb7c4"
          },
          "contentHash": "2b02ddb668926782e87cbb562110217779fc2b736de9872ecd94fce79a9a5e8a"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "f7e913bd-82c7-5e19-9d6d-92a269fc8316"
          },
          "contentHash": "05df376d45bddec943a4e4d573dd65e46ef340d9f2aac36ad14ed6c49f37ca77"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "8127640a-e75e-5f52-8ae1-edb800c6ba1b"
          },
          "contentHash": "e98266b51565a29e8161852eaff09118419056356ef449b749ee1d85d924abf3"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "2f63fd46-40a1-5d33-8e97-737792e99267"
          },
          "contentHash": "cf31a140c327f84b47851bdd181b047b1127a5990b3ba88d38e4554cec4b4e27"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "f3377467-58aa-5a64-ae7a-6201e1c69bf0"
          },
          "contentHash": "6999bcaa7fa0dc29d54cf22766a9c54cc904b6e317e32bc1f0cf52c7fad5518e"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "b8a58b12-1d19-5825-9480-a856806dac32"
          },
          "contentHash": "34ad7ca109de487d6a55c82d0371d97de684865211267b24b33427923ca6a6c3"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "82acf485-5ca9-5013-81ef-7a25fbad611c"
          },
          "contentHash": "6a02354c450ca14ec6f09ccb2f702741941a31763a30cb3ee9bb2bb09e79a2a1"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "26d604b3-1ed3-5882-9e70-1351080aac33"
          },
          "contentHash": "be2ca64f0c7235b12ddcbe92653a6e10e08283e92c27bf2c95b6a6d22dcf1266"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "ee418f7f-bece-5ef0-86de-f009fff075cd"
          },
          "contentHash": "2d4f60fb2184e721c151d28300d781012ec744e003dc3f36836e387cffebb1ab"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "04c7f123-49ee-56c1-9d59-217ee3aa05e5"
          },
          "contentHash": "4944c58827a6169800f153fa71bc65d1027440c599d2c4c55ce5265a3ac88e24"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "0ddb9b5b-233a-5eac-a2c2-8468ef590d7d"
          },
          "contentHash": "4f2658dadbd6306b1e61ca33fd8411235be7f153e25900c12ceec5bb13f562eb"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "4ab0a4b0-d0c4-5d0a-a369-e83d2eaa298a"
          },
          "contentHash": "3f0edf07756130109f33dc11bb98779729800175e6d4070f963382bf8dd8538f"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "509722a4-f3f9-5b9a-929e-5fb4aa2b5002"
          },
          "contentHash": "4a24f2311cd4b03b0636f46eb1dedd30e2ebe444ef437955193cfb1cbd7d4bb4"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "f08ffb2a-8cb7-5044-abe7-ba30a33952c6"
          },
          "contentHash": "a99bc89e133c31c3dbc79a25ddeafd6a450060293fe1fbe261f21dd7245bc4f4"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "8eb4fa1f-082e-5c59-94aa-7d2e9fb48d55"
          },
          "contentHash": "bc9e05769e5a537be5fdbe21f8431ed36b3de7c28cd6fab5cb6dc0ef984cea2e"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "57775a92-3b49-5af3-a616-a1e95dbb35c5"
          },
          "contentHash": "d3c3ebeb5c0406893fb2440f49d43a00893acbf4654d4f3cf5f4ee5efc4780e8"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "ab200de7-647b-53b1-bbaa-62fffd909efd"
          },
          "contentHash": "789aa8b7103946e818a2cf6ec6a2a9002c56839956e94618ae7392ed22a43374"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "5ac9461f-910d-562d-97ff-07c4ac79f910"
          },
          "contentHash": "44dfa5551b007c7d5f16b8074887c7f63ac00de0144ca83cea0b2fbfced74122"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "0a657f11-3094-5529-9f50-b0631cfda684"
          },
          "contentHash": "dd0121bca296f607fa470f5204d5209134a8acc1c0d449083c3bee832aec92ac"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "bb8f6fbe-6666-56d2-ab1a-fffa30d6e65b"
          },
          "contentHash": "166e708f5b50a61d56029aef4c8a62c7ff3c4908d67117194be02318550d16fe"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "776ff550-fcf5-5e10-9f57-0ccd4e4405e9"
          },
          "contentHash": "33fc91202c07466864d3fe53ad3e7040f291298f196789a0e9ce61842b4fc3b3"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "85a0d7c3-cfa1-59c3-b567-aa38b95cf827"
          },
          "contentHash": "658199b458c664c35fe4a4b37d2e9c0f34ae4f5b7c14c59f905eb40abdce262c"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "d71c8fe8-510f-5963-934f-07fd65292c0f"
          },
          "contentHash": "6a425ea65655521a2562ed148a2c9e0608b47ed4fb3e89d109e890a593e8fa1a"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "9a553853-a047-51b4-bf19-cd80b83a2b97"
          },
          "contentHash": "a89d49268cd6ab0e32eb39516a48a1cd23323e92820cac13659d4f386b93e5e0"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "277fe194-34bc-5285-8089-4a89e9fb06d2"
          },
          "contentHash": "afcf2bc786141f83a69fe231db933e14118d16e15912f93c54acd1314db0a8e9"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "5cadd48f-f9f7-5cf7-b8d1-33183a86b2b3"
          },
          "contentHash": "6309fbc43f242b21cb24a22e1bcb22c05a0dd0375b376b7449c9f060eececc1b"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "5479dec0-6e98-5f80-845a-49022ba50857"
          },
          "contentHash": "100eaf5a39cdf387e7c7371de0837f1e1e17c38abb35304eb435d41cdad33d74"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "76ab5c86-aa31-5f89-b23a-ac230272f318"
          },
          "contentHash": "8005c039bd6f32b95375526d5db17b6035c9ec8a51677fec59537231bd18cd7f"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "4c7f80dd-8cf9-538e-8246-40d0824288c7"
          },
          "contentHash": "681aa1c02bf977b263446cf020dd83c4dd90a0533f59f60a8f5d3a87bc0aa61d"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "d8309a52-86a7-5ec3-98fb-c6951156c81d"
          },
          "contentHash": "40ecc952acf9edae595218aaa986775dda0f8ab72f7dd3311106a72920be7e8d"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "45768228-57c0-52b4-acab-15d2f2b4cf9f"
          },
          "contentHash": "1e5270a90394a06d1d4a89676739623d444c9ab148d93a2f2055557e03ac499a"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "8fff62be-6288-5a95-8381-386fcd5f1e42"
          },
          "contentHash": "8a1468337ee12060bb5d41f5dec895390deffdc1969f5b305b21ca499a780aa1"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "388d9565-f8e8-5cb2-9e21-4b9d9d3ca8da"
          },
          "contentHash": "922b9f56b525c2123ce062b694d3c476b6c2364c3e17bb09fc0f2b4a17125f18"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "a6366c7b-79cb-594a-86c4-3be3c2c3beb7"
          },
          "contentHash": "145ca327b532d16e74cb74e41d642c3ca6ace82c913c8a4ded6c9cadb90a1b6d"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "beb4c4dc-7eb9-5deb-8cf4-dc1cf873cb60"
          },
          "contentHash": "aa2ffe7acf65db6b968c57d887dd450ad1b13ede778c0a282084a707b6a68f11"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "7a585c93-4a92-5935-9f32-f059aa9da331"
          },
          "contentHash": "fcba06adb88dcce54c0d1999f729cc94ec948c881577582e488ba45fa7ac3bae"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "b739b41c-ce67-52a0-8699-80dd61026f0e"
          },
          "contentHash": "dd62e39689eeb4fce1f791311a1961a6fe60a79f31b90ad743127393f9fbf74e"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "f9d18c7a-663b-5df2-9e61-96faf55c7635"
          },
          "contentHash": "c8336ae8bc85428536db3dcf41b5d111a581f948db11e3c4c231f41133df01ca"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "06c0cee2-cc0d-5ba6-b190-418ce13f9b54"
          },
          "contentHash": "752068f56a034637239e358af0211904aead6d0cdae1a986d22241ccdd068ef6"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "7ab7ee90-0ce9-52a6-ba04-abf81beeb5ac"
          },
          "contentHash": "d0d78757fe66ad0d8adea32d453749a9b58811b7c3c27de12ccdf898eca2486f"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "12a3302b-9c33-5d42-b6cf-987ee10d6fb0"
          },
          "contentHash": "a40c5f95cd6e4bafec1be1dfcea367331cd57ec0ade1549b9535f1666d73d4e1"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "dd3c3a84-c93c-59d0-951c-93eeeac74895"
          },
          "contentHash": "52a20d2bf97bb4112ea42b81a8c86cba9d92e5d2aba0b2dc1a31ce675219d459"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "74b01a8e-f45b-50b5-985a-f199c652f9f1"
          },
          "contentHash": "edd363e181d204ff086c93e67de55ab2cb0015e9bafb4f6fe9f7e301e0fcca56"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "b1e11ab0-311f-507c-a240-a09a706f5321"
          },
          "contentHash": "f42a1f060b788103e1a67b7e0cfb6b311a3db48c7143817d05fbf51c4b0b85a3"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "d57630ad-f59a-52a4-9191-e7c0ea787fdc"
          },
          "contentHash": "77c03c04b6326e22c283a0d8be3d15b10e974d59415d800082fd3b0e3474360c"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "a7828668-1ddc-576d-b814-2a164b4fae9d"
          },
          "contentHash": "4dbe5d3236e24c94e6cd646f01b33183ad7db92722143c1ce2aa33b525391420"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "ff36babc-e76b-5ab2-986f-65b45feaf378"
          },
          "contentHash": "26b0c4102732d007b3c7d677927678301f1e051775ae94da30adbf21f65f3ef9"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "02cd71ba-79fb-5ddc-84c9-5bf4b4f34504"
          },
          "contentHash": "8b8785b7ce408fde4792840e0f7ce83b05153b00012d1683f25dbf471305cabd"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "8dcae170-7428-5283-9cd0-bff4450708b8"
          },
          "contentHash": "23cf7c62f2f8029310deb7ec23451d60fc6f3fdfcf1c429250c2875168758792"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "73299d6e-43e0-5681-914d-945899ece740"
          },
          "contentHash": "b8d11dfd78418082a9e697ef82b80c1cb3a9915c9d4f7b99bf29229240c72bdd"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "ce338fea-8551-5e07-993e-880157743a60"
          },
          "contentHash": "c28f7fb16b0179c7b8ecb3755bcc7954b3dbc2e3e5d9ccee7d5f042353f45c67"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "df47bfb7-31f2-5678-8cad-036307e25cc1"
          },
          "contentHash": "a28d8c701dfabb6a75a75158e614ebe328783055b597fd1be8d0b480c7b5ebc3"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "a122b877-0cf1-5c43-86a0-6b4015657f13"
          },
          "contentHash": "c17018235ac0f0118eefd16f52611e00805a5acb47b3881410344fba904e0a50"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "70721d79-da49-5bea-950d-1649bc873af4"
          },
          "contentHash": "9668355fbcd3c126b59f432c20f1cb124a6964556f5e314220aae840d03f9e3e"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "71eee88c-d665-58c0-8c42-f396c0ced036"
          },
          "contentHash": "c80873ce705d6e9620ea8cf8b9f7a96f5d858364e4fa15f44ca116ad288b69e6"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "760cf073-697e-5409-9525-3d8514fbf041"
          },
          "contentHash": "6b532b2606bf0f06ab3468c991f01b72e5ff6039b73d73406583571f296e37b6"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "81f65c00-19e6-58ce-9113-b6ec7a3ef746"
          },
          "contentHash": "ab4608e3cb0423d50d1b8c19614f553d3f8e47228cea2d03056ff820f3f72445"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "985eaa46-4827-5fb1-99b3-38f6ec2f584e"
          },
          "contentHash": "3e2ce0a6ab355e57010120436676b8bdd9b24aee6ba01f978b168df12a1c58d8"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "43698c86-93bd-593a-8b49-16fc6d2063af"
          },
          "contentHash": "77f87e630aaeaab8427e3cd45b2f3d7db0a4d7a2aa3f0a9a68e6de5da935646e"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "458d8bee-470f-540b-81a6-eaee04205258"
          },
          "contentHash": "36430236b32a27a1cc53e57ac4d8e2c2e8685f7fe80f2df0f47a0c0b0c8827a1"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "78a1778a-4ad3-5a39-bc0e-7c7d7abd7f5d"
          },
          "contentHash": "d1fe7fc4430b0782cc0d6afd1220ba11ec859d6cd678e4a6ba2c5f9ba0ff01b8"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "15055c2b-fcbf-50fc-81e8-8fd1dc03dbb0"
          },
          "contentHash": "c2cbd3a7f55db0ab354460d92fea167d52e265c5f7e9d183c797f5013c4befda"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "ec3c905d-ecbd-5e35-8dd9-e514f995e3c1"
          },
          "contentHash": "d91e91e5df3c1aa401a0c9ee3a2e81a6df5a27fd4d8a42173ee13c1e0e5cbea9"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "2686d532-0e91-50ea-8666-107580f797fb"
          },
          "contentHash": "11cc0a6a486c56efef010252dc6710191b77485d62986f7bb2cc3a13567ca3fe"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "35e0a4b7-eff2-55f5-a13b-1c6c800d1781"
          },
          "contentHash": "3caad67c14487c68196e516500c86960c8a462b1c76b744aaaa461baf14c6c62"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "8ccbf09e-0c25-5dc6-8812-fee8f79505f1"
          },
          "contentHash": "07d1b52241f6854e8e112b85ee94a7f29f4ea550cc0d656587202460e380eb0b"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "33dfe796-1993-5833-bdcb-7e0f7d819318"
          },
          "contentHash": "6a16cd222f330823271cd16f0be74b097bb2b16d96a46e6f1e4f142cf72a15d8"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "74956566-2f4e-5379-b371-f7978f24d782"
          },
          "contentHash": "4c2edd69ae818943be79c8f180d29df57adbc1f0700b40846c32ac040fcd9c00"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "68c28b80-c03d-5495-afdc-c00bc0189c26"
          },
          "contentHash": "cd832dc810556ba9c7399d1c554a62df505f7a52ee40242c542dae305bf2f872"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "14512d63-722e-5f07-b3c6-8d0dd0e68651"
          },
          "contentHash": "f3f76ac5cfe21a98ddfbc4f8fa92bdd1669cd5380891ad457187b5a7cc78b234"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "d2a9bb29-f13e-5cb0-b3d6-2e9591748770"
          },
          "contentHash": "92c15346e800fb7a7f5b1b77c7575ac25b08ee0b8c47cccce4ad44ec46003e89"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "588e789a-3ea1-57db-a574-9734ad0fae89"
          },
          "contentHash": "1db40ad79849af8994568bd5ee5c9c0f65a3e46ed5adadab044089ede8438c32"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "2f8fa818-af21-5077-93de-087d4670f481"
          },
          "contentHash": "2022e829cefc0299e0ce9a43c6719e8298cd96d59b0a9f2f0e45184c05ee7a86"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "f45bd8d6-35b7-5845-87c2-a4aeeb29923b"
          },
          "contentHash": "8be372843cec0bc4446371fb1ad9bca130ad39a6498cb738e3ed8b932517eab8"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "99674a5d-a226-5c71-863b-dad8afc78be8"
          },
          "contentHash": "7bb63f35c384bccb4ed6873430d78be258f8423949dcec81e6d18411c667ee40"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "24579444-3a28-58de-b57c-670a2961cf61"
          },
          "contentHash": "3f5978798f59189cc3de81e8e25a901fc94e4421f650a89bbc0f74088455b149"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "672f9b51-e3a7-5c9c-a22b-1f5b3c4c174c"
          },
          "contentHash": "128e0e3a436711e49499dba210d0545d08b459371173dad0025ba21bc7a227f7"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "af831713-88a3-50a3-b94d-d0de288073b2"
          },
          "contentHash": "eb6762c86fb3ce824b8303a384288200cfede3a5312223087fc94c8060a3d226"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "96a76c01-8209-5c21-b8c2-efd9a3b07814"
          },
          "contentHash": "d9d990180fd1eec1ee373c9ea8b19a37b1d9d9069c8c4efd06f729487794f1b5"
        }
      ]
    },
    {
      "table": "tournament_discipline_rules",
      "identity": [
        "tournament_id"
      ],
      "columns": [
        "direct_red_suggested_matches",
        "double_yellow_counts_as_red",
        "fair_play_enabled",
        "organization_id",
        "red_fair_play_points",
        "reset_yellows_each_stage",
        "suspension_matches",
        "tournament_id",
        "yellow_fair_play_points",
        "yellows_for_suspension"
      ],
      "columnKinds": {
        "direct_red_suggested_matches": "number",
        "double_yellow_counts_as_red": "scalar",
        "fair_play_enabled": "scalar",
        "organization_id": "scalar",
        "red_fair_play_points": "number",
        "reset_yellows_each_stage": "scalar",
        "suspension_matches": "number",
        "tournament_id": "scalar",
        "yellow_fair_play_points": "number",
        "yellows_for_suspension": "number"
      },
      "ownership": {
        "column": "organization_id",
        "values": [
          "a5627c00-6b91-59b8-a366-455261e6e8de"
        ]
      },
      "rows": [
        {
          "identity": {
            "tournament_id": "439fd0cf-ce9d-53b7-9d6d-d64d680dafd0"
          },
          "contentHash": "18823dbf7021706a37a574d69db21d38d80faf62c754043dbd970809d7ec3399"
        }
      ]
    },
    {
      "table": "tournament_discipline_ledgers",
      "identity": [
        "revision_id",
        "roster_player_id"
      ],
      "columns": [
        "automatic_suspensions",
        "category_id",
        "direct_reds",
        "fair_play_points",
        "group_id",
        "organization_id",
        "phase_id",
        "revision_id",
        "roster_player_id",
        "second_yellows",
        "team_entry_id",
        "tournament_id",
        "yellow_cards"
      ],
      "columnKinds": {
        "automatic_suspensions": "number",
        "category_id": "scalar",
        "direct_reds": "number",
        "fair_play_points": "number",
        "group_id": "nullable",
        "organization_id": "scalar",
        "phase_id": "scalar",
        "revision_id": "scalar",
        "roster_player_id": "scalar",
        "second_yellows": "number",
        "team_entry_id": "scalar",
        "tournament_id": "scalar",
        "yellow_cards": "number"
      },
      "ownership": {
        "column": "organization_id",
        "values": [
          "a5627c00-6b91-59b8-a366-455261e6e8de"
        ]
      },
      "rows": [
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "a3370601-8ffe-52a0-a802-b6d376a528e2"
          },
          "contentHash": "96d6697ae089f8fa2eea5bd2c58a6e5f31eab93ec9a3804a978259ca8ada5d2d"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "09041088-abbd-50ec-b204-17b234ceb7c4"
          },
          "contentHash": "9e564da19ac4a0434db8e890656b454255e51044c15be480d5f9a01327bb9ab0"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "f7e913bd-82c7-5e19-9d6d-92a269fc8316"
          },
          "contentHash": "33b72d4a7ac4a4711cffc836c41fcd99ed97167efc52f47472f5c56f9cfa9224"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "8127640a-e75e-5f52-8ae1-edb800c6ba1b"
          },
          "contentHash": "f229c192d4ea4b7440c1648fe83a97e8b117f23fb7f4fc1668ce804e1a332650"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "2f63fd46-40a1-5d33-8e97-737792e99267"
          },
          "contentHash": "cbf94340d520ed7a71d79e80f3dc6ce26dcafec10f0a872af9a73fa53cd9ee06"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "f3377467-58aa-5a64-ae7a-6201e1c69bf0"
          },
          "contentHash": "a2b664f76152071a8e00bb82f4d0282c4d73a0f10b8521990f241ff54cd13cf9"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "b8a58b12-1d19-5825-9480-a856806dac32"
          },
          "contentHash": "da54e4f0dd8ff15f4119f987c87fc0d045f10e65187d2d045f248e99b057a6ec"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "82acf485-5ca9-5013-81ef-7a25fbad611c"
          },
          "contentHash": "1ef0c2d77774a2755a9c4ea2b9b2a1ec69b65967e25f3079c1b59aa44334803d"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "26d604b3-1ed3-5882-9e70-1351080aac33"
          },
          "contentHash": "291abd474622fdd972b7f2c3b42179d9ad765b2ea5c8b6627054694feb75576f"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "ee418f7f-bece-5ef0-86de-f009fff075cd"
          },
          "contentHash": "8cf56837650948600a3bdce762d2e7b8bd475f3dc6ffe48107bfa9a039b9c5f1"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "04c7f123-49ee-56c1-9d59-217ee3aa05e5"
          },
          "contentHash": "0afc27d0ba48e424ecd100585922fdd35c579e08301a5ab627532607babdba69"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "0ddb9b5b-233a-5eac-a2c2-8468ef590d7d"
          },
          "contentHash": "e2740e532865321f6d105d7bc2dde0a16e062e60d95cb16e3d5f3d682c996ade"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "4ab0a4b0-d0c4-5d0a-a369-e83d2eaa298a"
          },
          "contentHash": "e4a9b43283b94862d0d09fef15f0a4a24e4b9282136b4264a8053a14f4b5d694"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "509722a4-f3f9-5b9a-929e-5fb4aa2b5002"
          },
          "contentHash": "1c0eb35f327cf8babd99d8d36cbc6fe01d588b25d8628c00fe9754b007193023"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "f08ffb2a-8cb7-5044-abe7-ba30a33952c6"
          },
          "contentHash": "638011349f181accb22854ac99b466f1d9190f87fb95cdda7aa30fdbb9c85da0"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "8eb4fa1f-082e-5c59-94aa-7d2e9fb48d55"
          },
          "contentHash": "aaadc4e8c38873aa8be29eabdf7710283d9ed0f822fc7bf2a854c82689ef02f2"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "57775a92-3b49-5af3-a616-a1e95dbb35c5"
          },
          "contentHash": "e2e46a2350bfef0f7772764d614be91bd7f9031820ae587b00cc87fc642f2fe1"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "ab200de7-647b-53b1-bbaa-62fffd909efd"
          },
          "contentHash": "b5fa63deac582fe7269737278918f71a44688c2ac72615aa10099ec4ba3192fc"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "5ac9461f-910d-562d-97ff-07c4ac79f910"
          },
          "contentHash": "36ff1129f103fcbdf6f9fe4552febf6f37be7d787e92fdd158dfc2bd90b90e2d"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "0a657f11-3094-5529-9f50-b0631cfda684"
          },
          "contentHash": "a99aafb72056583b5d421b630081a70ac66838951317b096cda7eb93d969fced"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "bb8f6fbe-6666-56d2-ab1a-fffa30d6e65b"
          },
          "contentHash": "dc8eb8c0af8f731f470a954cdead42606ebb42eb7305058179db604e3f4c645d"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "776ff550-fcf5-5e10-9f57-0ccd4e4405e9"
          },
          "contentHash": "1812304d09b63553cc6d313810a9d8c2d485a6565823c1b0c79720aee55b417f"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "85a0d7c3-cfa1-59c3-b567-aa38b95cf827"
          },
          "contentHash": "9690adbff280cc10dcdbac557eb3aeae4b9f1741747100dafb0242dec55650d3"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "d71c8fe8-510f-5963-934f-07fd65292c0f"
          },
          "contentHash": "5904dde1af858ba9bef60a7adc1fe9e40b0a881cb26f11c619e0844ff7993f97"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "9a553853-a047-51b4-bf19-cd80b83a2b97"
          },
          "contentHash": "b0e3847a5804787fcd9791b149ae5efaa133e9d5fc2d425cbb2bbe1bd3ecbbd5"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "277fe194-34bc-5285-8089-4a89e9fb06d2"
          },
          "contentHash": "6bb7426f1acd7b06bb9e692447a5e93bb410e507b2ff0f0759c36a3fdbd360fa"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "5cadd48f-f9f7-5cf7-b8d1-33183a86b2b3"
          },
          "contentHash": "9be292907dd254cb73e76a7306a62d9865cae40627dc33458c8d20e434490bd4"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "5479dec0-6e98-5f80-845a-49022ba50857"
          },
          "contentHash": "eaa373e58917d64b2dd0e602f0b14a23a5f7910269c95e2e71373609ef7325ba"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "76ab5c86-aa31-5f89-b23a-ac230272f318"
          },
          "contentHash": "f7a0556c266de2648980f32f4f2cbddbfaf567e324414162d915d809cb1ffb58"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "4c7f80dd-8cf9-538e-8246-40d0824288c7"
          },
          "contentHash": "2188f49cd075c1233059b1b639dac935d3ffb797846582b03cff633ceb3580c5"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "d8309a52-86a7-5ec3-98fb-c6951156c81d"
          },
          "contentHash": "3f8313ec54cf59eda2da08cb696f3f103846652808b6f5489031cb76a92efeab"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "45768228-57c0-52b4-acab-15d2f2b4cf9f"
          },
          "contentHash": "68bfb680a6aef8c82e3abea5d796ec984cc552408f8889c9ca88529e18e9f2d0"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "8fff62be-6288-5a95-8381-386fcd5f1e42"
          },
          "contentHash": "bc7bfcc753f23d4bb149d2883db1416fc136c78974d402c0bcffd4421250a274"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "388d9565-f8e8-5cb2-9e21-4b9d9d3ca8da"
          },
          "contentHash": "60ab5b625c41ab2789d74bd5bd68625745a3edb2e5a222550c2e8755e63c2d76"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "a6366c7b-79cb-594a-86c4-3be3c2c3beb7"
          },
          "contentHash": "31c91b4935ca9e6435c1db255aa18302632721a9fd79a484446a787149eed199"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "beb4c4dc-7eb9-5deb-8cf4-dc1cf873cb60"
          },
          "contentHash": "3fd7f27f7532d37aa6d70a9f4fcf07a7c6aba029c44e4b18f667e6bda655d5c1"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "7a585c93-4a92-5935-9f32-f059aa9da331"
          },
          "contentHash": "6b6f209aed311897f6310bc59d457fda4ba759445e06ee2cb2909678c9eec252"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "b739b41c-ce67-52a0-8699-80dd61026f0e"
          },
          "contentHash": "f2105ffee84a46a7fc4c21d7bbf6ce254fa13816dc349cfe77ff346eb3da310f"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "f9d18c7a-663b-5df2-9e61-96faf55c7635"
          },
          "contentHash": "cbee538821d35fd243ca4599744fd49ca08a3fccf0f71f7ee5033ba14ee546d6"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "06c0cee2-cc0d-5ba6-b190-418ce13f9b54"
          },
          "contentHash": "b4ce1568698303289da408a8bcfb3058176f57910b40cb8b3bb6c8ca4121c8eb"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "7ab7ee90-0ce9-52a6-ba04-abf81beeb5ac"
          },
          "contentHash": "1809c0bd1d641d1152c7b35ddd7292ccc5ba93b69ddd278e8cc354239ab4b0f1"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "12a3302b-9c33-5d42-b6cf-987ee10d6fb0"
          },
          "contentHash": "b14339f1132520faf8c65f2be0f3f9cabb72102626901aed9df4af5b1b55a0e2"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "dd3c3a84-c93c-59d0-951c-93eeeac74895"
          },
          "contentHash": "3981a1ae9ab99109e447cc0d37e782f081ec54031e74b03ea4e69545ade83b0f"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "74b01a8e-f45b-50b5-985a-f199c652f9f1"
          },
          "contentHash": "a45c238ea52d7a34856e8abe12ff4767971ae70ef629ae05b0d6cac4b4e58307"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "b1e11ab0-311f-507c-a240-a09a706f5321"
          },
          "contentHash": "adc0969de9faf53bff4b12b466aba86769e1d8b510d667fd1777e5bcf10d4969"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "d57630ad-f59a-52a4-9191-e7c0ea787fdc"
          },
          "contentHash": "b3df1ac38fba532c0fd3db039b84248273cb14e1d7174f399968a521b951ec9d"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "a7828668-1ddc-576d-b814-2a164b4fae9d"
          },
          "contentHash": "ade791bd3920b84bdd0e18bf2dc82e3561e3c681b6ed8d17b0ba296064c34ad2"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "ff36babc-e76b-5ab2-986f-65b45feaf378"
          },
          "contentHash": "7f79dbe3c238c60918c88898ffd974d3d0a07f45ef56573a74403576747c1d34"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "02cd71ba-79fb-5ddc-84c9-5bf4b4f34504"
          },
          "contentHash": "65fcf0de9837be68123f279b0dc9cea05a8bbcf0ab25ccc25548fa6a294b8177"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "8dcae170-7428-5283-9cd0-bff4450708b8"
          },
          "contentHash": "d200c183c085ce29087603e0aef04aaf6f37d8856c520c703577623d671a6dfe"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "73299d6e-43e0-5681-914d-945899ece740"
          },
          "contentHash": "16b85109140cfe2426c8b123cb6dbaf26974a6020639f8d80ec276d84dc4e34d"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "ce338fea-8551-5e07-993e-880157743a60"
          },
          "contentHash": "4f9e7271e8ede77d436df2b1e570fa7f48a54706253475eac6a45a99c7251b0a"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "df47bfb7-31f2-5678-8cad-036307e25cc1"
          },
          "contentHash": "c4354080c364821c3014f224222669b4402ddbc177c4e73e422f56dc2899bac3"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "a122b877-0cf1-5c43-86a0-6b4015657f13"
          },
          "contentHash": "774e7fa7b4b041f2e873edb414625290e37673fc5919ff274929feb61c948ab0"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "70721d79-da49-5bea-950d-1649bc873af4"
          },
          "contentHash": "53a98bd4310d45e8de96928a7d1fda069efe3e6f517f182af1130d3f383f7319"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "71eee88c-d665-58c0-8c42-f396c0ced036"
          },
          "contentHash": "27259cd0030b361838e71b662eead69c486f3ba19d1c232689a1fd47f13dad80"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "760cf073-697e-5409-9525-3d8514fbf041"
          },
          "contentHash": "54adb50c8b5f1d0de05c9befbe88807855ea8021e89bb11aad2a527c64b7c01a"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "81f65c00-19e6-58ce-9113-b6ec7a3ef746"
          },
          "contentHash": "a1dba1324a95a130cd73a6e5e9ee935effca381a7066394d54018eab38779db8"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "985eaa46-4827-5fb1-99b3-38f6ec2f584e"
          },
          "contentHash": "e2db067b5ef58f895e8c70769e38fae6c1d5f0d2e496616c18dbe955ce949c65"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "43698c86-93bd-593a-8b49-16fc6d2063af"
          },
          "contentHash": "17e37fe0d20ae05b6fe03375496313601602be000a6008aabda095082943b516"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "458d8bee-470f-540b-81a6-eaee04205258"
          },
          "contentHash": "2ffa3086a87fd9bde664b1866158e670d26341b220c2f53305a668a0ed5c125f"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "78a1778a-4ad3-5a39-bc0e-7c7d7abd7f5d"
          },
          "contentHash": "79d835b16d99404442595fc7ff320d6418589ce4819d6c99ecf083d3828a9c0b"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "15055c2b-fcbf-50fc-81e8-8fd1dc03dbb0"
          },
          "contentHash": "6ed371cab33f3fd053ab9783d678909c10de30165da65dc636450406dae1027f"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "ec3c905d-ecbd-5e35-8dd9-e514f995e3c1"
          },
          "contentHash": "7346538ab108c2593c0cbabd7d19b78d724f7030218b18267dbafc975685d56e"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "2686d532-0e91-50ea-8666-107580f797fb"
          },
          "contentHash": "65df0a183894024be4fbde9925cf6d7eb66147e0623c8b9e4b514dab77f3b5c1"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "35e0a4b7-eff2-55f5-a13b-1c6c800d1781"
          },
          "contentHash": "6485a7751de5a19848ab86cbd17251d89743eb61e5d470a5b64f53a8a6cc5122"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "8ccbf09e-0c25-5dc6-8812-fee8f79505f1"
          },
          "contentHash": "4635c06c551fcbbd020aa1d347c4aedbcfbbf727205e6ac0578d23426abec198"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "33dfe796-1993-5833-bdcb-7e0f7d819318"
          },
          "contentHash": "fc1180b248ad6965ff74e898d916254d42f971b016cb9ddf91dfe11a0adbc54f"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "74956566-2f4e-5379-b371-f7978f24d782"
          },
          "contentHash": "06bd657760d2ec42126929ee94fe00b4cab2547a1e65940817e7a9c8418a099e"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "68c28b80-c03d-5495-afdc-c00bc0189c26"
          },
          "contentHash": "89246080bc41b98ad93157dc247ee7e20b0c10bdc28a81f9dcca495b3cbc9ca6"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "14512d63-722e-5f07-b3c6-8d0dd0e68651"
          },
          "contentHash": "fd6bed42ec44984b77d5e7663b3a9bd550e71a7004b9ac1c3550f3924c9e8b2f"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "d2a9bb29-f13e-5cb0-b3d6-2e9591748770"
          },
          "contentHash": "ae94062340733370e4e070564927d0be3f4228fd3700e06027c84bb48cec1bf8"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "588e789a-3ea1-57db-a574-9734ad0fae89"
          },
          "contentHash": "f3d6aa88ec5941db4d08bd9162f5011357ae4a1d8a8da0c38cec77a32e2781d7"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "2f8fa818-af21-5077-93de-087d4670f481"
          },
          "contentHash": "57449dcbeb121c27f68a3bf346643ba2fee9c61d824a9333cfddd347f74f9375"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "f45bd8d6-35b7-5845-87c2-a4aeeb29923b"
          },
          "contentHash": "7f03d891be52869f48265fbdd1075b0ef5bbe8408bbc6097054b4f3fb5a6ebe7"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "99674a5d-a226-5c71-863b-dad8afc78be8"
          },
          "contentHash": "6be5cd777b33d2e7bbfa71e33c407260a99595cd419595aef073fd19ed6d6996"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "24579444-3a28-58de-b57c-670a2961cf61"
          },
          "contentHash": "8be48f768c3f21a15d9a44c3fedc1b5af05f9d84f1b17eebde55a835dcf2acbb"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "672f9b51-e3a7-5c9c-a22b-1f5b3c4c174c"
          },
          "contentHash": "a10d7f00d694896c5aaf0df33a490f7bbbbc9b3f6fbb4515229418772323cdc1"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "af831713-88a3-50a3-b94d-d0de288073b2"
          },
          "contentHash": "48de6f31c649caeca970e269ef9332304899dd8d8c8c3d45bab0ee62b9500b7d"
        },
        {
          "identity": {
            "revision_id": "ac146a54-adf2-54da-9fa5-9a6e18a88118",
            "roster_player_id": "96a76c01-8209-5c21-b8c2-efd9a3b07814"
          },
          "contentHash": "c469373e8a6b15e7322f1ff5714f201583c7696c5f3c44ff17c37b91464148fb"
        }
      ]
    },
    {
      "table": "tournament_player_suspensions",
      "identity": [
        "id"
      ],
      "columns": [
        "category_id",
        "group_id",
        "id",
        "organization_id",
        "phase_id",
        "reason",
        "revision_id",
        "roster_player_id",
        "rule_snapshot",
        "served_matches",
        "source_event_id",
        "source_key",
        "source_match_id",
        "source_type",
        "status",
        "team_entry_id",
        "total_matches",
        "tournament_id"
      ],
      "columnKinds": {
        "category_id": "scalar",
        "group_id": "nullable",
        "id": "scalar",
        "organization_id": "scalar",
        "phase_id": "scalar",
        "reason": "scalar",
        "revision_id": "scalar",
        "roster_player_id": "scalar",
        "rule_snapshot": "scalar",
        "served_matches": "number",
        "source_event_id": "scalar",
        "source_key": "scalar",
        "source_match_id": "scalar",
        "source_type": "scalar",
        "status": "scalar",
        "team_entry_id": "scalar",
        "total_matches": "number",
        "tournament_id": "scalar"
      },
      "ownership": {
        "column": "organization_id",
        "values": [
          "a5627c00-6b91-59b8-a366-455261e6e8de"
        ]
      },
      "rows": [
        {
          "identity": {
            "id": "f6eca9d2-cb11-5368-8efb-89a1ff3db8ef"
          },
          "contentHash": "f825552cb56f32ef8323e79ba3e7ae557c1ca9b525a516e86c15acfa490db17c"
        },
        {
          "identity": {
            "id": "3ec661db-e17a-57d5-933b-8960e3945e30"
          },
          "contentHash": "69ebc13048bbca64187123775e2bb7e9a4f9970018bce4e531aad651edce5f34"
        }
      ]
    },
    {
      "table": "tournament_suspension_served_matches",
      "identity": [
        "suspension_id",
        "match_id"
      ],
      "columns": [
        "marked_at",
        "marked_by",
        "match_id",
        "note",
        "organization_id",
        "suspension_id"
      ],
      "columnKinds": {
        "marked_at": "scalar",
        "marked_by": "scalar",
        "match_id": "scalar",
        "note": "scalar",
        "organization_id": "scalar",
        "suspension_id": "scalar"
      },
      "ownership": {
        "column": "organization_id",
        "values": [
          "a5627c00-6b91-59b8-a366-455261e6e8de"
        ]
      },
      "rows": [
        {
          "identity": {
            "suspension_id": "3ec661db-e17a-57d5-933b-8960e3945e30",
            "match_id": "1cd552e7-f2b1-5c4f-83b1-e96f1379806e"
          },
          "contentHash": "ecb15ec5fb444d639b35efc9ce1b474374020cefbf9d042411fcfc289963af18"
        }
      ]
    },
    {
      "table": "tournament_audit_log",
      "identity": [
        "resource_type",
        "resource_id",
        "action"
      ],
      "columns": [
        "action",
        "actor_type",
        "actor_user_id",
        "created_at",
        "metadata",
        "organization_id",
        "resource_id",
        "resource_type",
        "team_entry_id",
        "tournament_id"
      ],
      "columnKinds": {
        "action": "scalar",
        "actor_type": "scalar",
        "actor_user_id": "scalar",
        "created_at": "scalar",
        "metadata": "scalar",
        "organization_id": "scalar",
        "resource_id": "scalar",
        "resource_type": "scalar",
        "team_entry_id": "nullable",
        "tournament_id": "scalar"
      },
      "ownership": {
        "column": "organization_id",
        "values": [
          "a5627c00-6b91-59b8-a366-455261e6e8de"
        ]
      },
      "rows": [
        {
          "identity": {
            "resource_type": "manual_curated_team",
            "resource_id": "c57a58f0-e86c-54ae-a3ba-dd0962d2aa41",
            "action": "qa.team_of_round.manual_curated"
          },
          "contentHash": "e681b499e0ea9caa2d94625f088062398b955607da39b9a5024bbc0ee03fe773"
        },
        {
          "identity": {
            "resource_type": "qa_seed_execution",
            "resource_id": "b66dc982-e959-5780-8b72-ab70761e2bec",
            "action": "qa.seed.applied"
          },
          "contentHash": "a7f83d0aaac8e99736d309b395cb6be1824e827588a65c0bbe900a8e9fb59aad"
        }
      ]
    }
  ],
  "descriptorFingerprint": "d513f0141b84037df67bf854fa0ac6769f08c3171d0257a6416cf87f4d853d6e"
};

export const TORNEOS_DEMO_V2_CLEANUP_DESCRIPTOR = Object.freeze(
  validateCleanupDescriptor(descriptor),
);
