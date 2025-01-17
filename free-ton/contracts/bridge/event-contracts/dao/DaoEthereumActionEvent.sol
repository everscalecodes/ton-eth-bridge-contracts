pragma ton-solidity >= 0.39.0;
pragma AbiHeader time;
pragma AbiHeader expire;
pragma AbiHeader pubkey;

import "./../base/TonBaseEvent.sol";
import "./../../interfaces/IEventNotificationReceiver.sol";
import "./../../interfaces/event-contracts/ITonEvent.sol";
import "../../../utils/cell-encoder/DaoCellEncoder.sol";
import "./../../../utils/ErrorCodes.sol";
import './../../../../../node_modules/@broxus/contracts/contracts/libraries/MsgFlag.sol';

/*
    @title DAO Ethereum Action event configuration
    @dev This implementation is used for executing DAO actions in EVM based networks
*/
contract DaoEthereumActionEvent is TonBaseEvent, DaoCellEncoder {

    constructor(address _initializer, TvmCell _meta) TonBaseEvent(_initializer, _meta) public {}


    function afterSignatureCheck(TvmSlice body, TvmCell /*message*/) private inline view returns (TvmSlice) {
        body.decode(uint64, uint32);
        TvmSlice bodyCopy = body;
        uint32 functionId = body.decode(uint32);
        if (isExternalVoteCall(functionId)){
            require(votes[msg.pubkey()] == Vote.Empty, ErrorCodes.KEY_VOTE_NOT_EMPTY);
        }
        return bodyCopy;
    }

    function close() public view {
        require(status == Status.Confirmed || status == Status.Rejected, ErrorCodes.EVENT_PENDING);
        address gasBackAddress = getGasBackAddress();

        require(msg.sender == gasBackAddress, ErrorCodes.SENDER_IS_NOT_EVENT_OWNER);
        transferAll(gasBackAddress);
    }

    function onInit() override internal {}

    function onConfirm() override internal {}

    function onReject() override internal {}

    function getDetails() public view responsible returns (
        TonEventInitData _eventInitData,
        Status _status,
        uint[] _confirms,
        uint[] _rejects,
        uint[] empty,
        bytes[] _signatures,
        uint128 balance,
        address _initializer,
        TvmCell _meta,
        uint32 _requiredVotes
    ) {
        _confirms = getVoters(Vote.Confirm);

        for (uint voter : _confirms) {
            _signatures.push(signatures[voter]);
        }

        return {value: 0, flag: MsgFlag.REMAINING_GAS} (
            eventInitData,
            status,
            _confirms,
            getVoters(Vote.Reject),
            getVoters(Vote.Empty),
            _signatures,
            address(this).balance,
            initializer,
            meta,
            requiredVotes
        );
    }

    function getDecodedData() public view responsible returns (
        address gasBackAddress,
        uint32 chainId,
        ActionStructure.EthActionStripped[] actions
    ) {
        (
            int8 gasBackAddressWid,
            uint256 gasBackAddressValue,
            uint32 _chainId,
            ActionStructure.EthActionStripped[] _actions
        ) = decodeDaoEthereumActionData(eventInitData.voteData.eventData);

        gasBackAddress = address.makeAddrStd(gasBackAddressWid, gasBackAddressValue);

        return {value: 0, flag: MsgFlag.REMAINING_GAS} (gasBackAddress, _chainId, _actions);
    }

    function getGasBackAddress() private view returns(address) {
        (address gasBackAddress,,) = getDecodedData();
        return gasBackAddress;
    }
}
