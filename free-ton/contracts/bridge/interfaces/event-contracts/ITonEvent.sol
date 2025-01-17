pragma ton-solidity >= 0.39.0;

import "./IBasicEvent.sol";


interface ITonEvent is IBasicEvent {
    struct TonEventVoteData {
        uint64 eventTransactionLt;
        uint32 eventTimestamp;
        TvmCell eventData;
    }

    struct TonEventInitData {
        TonEventVoteData voteData;
        address configuration;
        address staking;
    }
}
