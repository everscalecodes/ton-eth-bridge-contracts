pragma solidity >= 0.6.0;
pragma AbiHeader expire;


contract EventProxy {
    uint static _randomNonce;

    bool callbackReceived = false;
    uint eventTransaction;
    uint eventIndex;
    TvmCell eventData;

    constructor() public {
        require(tvm.pubkey() != 0);
        tvm.accept();
    }

    function broxusBridgeCallback(
        uint _eventTransaction,
        uint _eventIndex,
        TvmCell _eventData
    ) public {
        callbackReceived = true;
        eventTransaction = _eventTransaction;
        eventIndex = _eventIndex;
        eventData = _eventData;
    }

    function getDetails() public view returns (
        bool _callbackReceived,
        uint _eventTransaction,
        uint _eventIndex,
        TvmCell _eventData
    ) {
        return (
            callbackReceived,
            eventTransaction,
            eventIndex,
            eventData
        );
    }
}