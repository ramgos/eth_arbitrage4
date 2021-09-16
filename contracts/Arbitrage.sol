pragma solidity 0.8.0;

import "./IERC20.sol";
import "./IWMATIC.sol";
import "./Ownable.sol";

interface IUniswapV2Router02 {
    function swapExactTokensForTokensSupportingFeeOnTransferTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external;
}

/**
 * @dev execute arbitrage opportunities
 * 
 * can only use WMATIC as the first token, all funds are kept in the contract 
 * and on doubleSwap it only checks if the swaps were profitable at the end.
 * 
 * the contract is unoptimized, for some reason if you set the minAmountOut
 * in the second swap to the amountIn, it throws a revert error. that must be looked into
 * 
 */
contract Arbitrage is Ownable {
    address private WMATIC;
    
    constructor(address _WMATIC) {
        WMATIC = _WMATIC;
    }
    
    modifier ensure(uint deadline) {
        require(deadline >= block.timestamp, 'ARB: EXPIRED');
        _;
    }
    
    function buyWMATIC() external payable {
        IWMATIC(WMATIC).deposit{value: msg.value}();
    }
    
    function balanceWMATIC() external view returns(uint) {
        return IWMATIC(WMATIC).balanceOf(address(this));
    }
    
    function withdrawWMATIC(uint _amount) external onlyOwner() {
        IWMATIC(WMATIC).transfer(msg.sender, _amount);
    }
    
    /**
     * @dev debug purposes only
     */
    function userWMATIC() external view returns(uint) {
        return IWMATIC(WMATIC).balanceOf(msg.sender);
    }
    
    /**
     * @dev swap twice using two different routers
     * 
     * all funds are saved within the contract
     * 
     * if amount gotten is lower than initial WMATIC amount
     * transactions will revert
     * 
     */
    function doubleSwap(
            uint _amountIn,
            address _router1,
            address _router2,
            address _token,
            uint _deadline
        ) onlyOwner() ensure(_deadline) external {
        
        uint _WMATICBalanceBeforeSwap = IWMATIC(WMATIC).balanceOf(address(this));
        require(_WMATICBalanceBeforeSwap >= _amountIn, "ARB: NOT ENOUGH WMATIC");
        
        IERC20(WMATIC).approve(_router1, _amountIn); // approve first router to use wmatic
        
        // first swap args
        address[] memory _path = new address[](2);
        _path[0] = WMATIC;
        _path[1] = _token;
        
        // first swap
        IUniswapV2Router02(_router1).swapExactTokensForTokensSupportingFeeOnTransferTokens(
            _amountIn,
            0,
            _path,
            address(this),
            _deadline
        );
        
        uint _tokenBalanceAfterSwap = IERC20(_token).balanceOf(address(this));
        
        // switch swap order
        _path[0] = _token;
        _path[1] = WMATIC;
        
        // approve all gotten tokens of type token
        IERC20(_token).approve(_router2, _tokenBalanceAfterSwap);
        
        // second swap
        IUniswapV2Router02(_router2).swapExactTokensForTokensSupportingFeeOnTransferTokens(
            _tokenBalanceAfterSwap,
            0,
            _path,
            address(this),
            _deadline
        );
        
        // cancel if amount gotten is smaller than initial amountIn
        require(IWMATIC(WMATIC).balanceOf(address(this)) > _WMATICBalanceBeforeSwap, "ARB: FAILURE LOST MONEY");
    }
}